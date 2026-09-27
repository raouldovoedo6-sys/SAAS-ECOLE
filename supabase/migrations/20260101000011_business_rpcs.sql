-- ============================================================
-- Opérations financières sensibles : encapsulées dans des fonctions
-- SECURITY DEFINER exécutées comme une seule transaction atomique, pour
-- éviter tout état intermédiaire incohérent (facture sans lignes, paiement
-- sans allocations, etc.). Seules les Edge Functions (service_role) après
-- vérification du rôle appelant peuvent les exécuter ; jamais exposées
-- au frontend directement.
-- ============================================================

-- ---------- Création de facture ----------
create or replace function public.fn_create_invoice(
  p_school_id uuid,
  p_student_id uuid,
  p_school_year_id uuid,
  p_guardian_id uuid,
  p_fee_installment_ids uuid[],
  p_actor_user_id uuid
) returns table(invoice_id uuid, invoice_number text, total_amount numeric)
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice_id uuid;
  v_invoice_number text;
  v_due_date date;
  v_total numeric(12,2) := 0;
  v_count int;
  v_already_invoiced int;
  r record;
  v_assignment record;
  v_ratio numeric;
  v_final_amount numeric(12,2);
begin
  if p_fee_installment_ids is null or array_length(p_fee_installment_ids, 1) is null then
    raise exception 'Aucun frais sélectionné.';
  end if;

  if not exists (select 1 from students where id = p_student_id and school_id = p_school_id) then
    raise exception 'Élève introuvable pour cette école.';
  end if;
  if not exists (select 1 from school_years where id = p_school_year_id and school_id = p_school_id) then
    raise exception 'Année scolaire introuvable pour cette école.';
  end if;
  if p_guardian_id is not null and not exists (
    select 1 from student_guardians where student_id = p_student_id and guardian_id = p_guardian_id
  ) then
    raise exception 'Ce responsable n''est pas rattaché à cet élève.';
  end if;

  select count(*) into v_count
  from fee_installments fi
  where fi.id = any(p_fee_installment_ids) and fi.school_id = p_school_id;

  if v_count <> array_length(p_fee_installment_ids, 1) then
    raise exception 'Un ou plusieurs frais sélectionnés sont invalides pour cette école.';
  end if;

  select count(*) into v_already_invoiced
  from invoice_items ii
  join invoices i on i.id = ii.invoice_id
  where ii.fee_installment_id = any(p_fee_installment_ids)
    and i.status <> 'cancelled';

  if v_already_invoiced > 0 then
    raise exception 'Certains frais sélectionnés ont déjà été facturés.';
  end if;

  select max(due_date) into v_due_date
  from fee_installments where id = any(p_fee_installment_ids);

  v_invoice_number := app.next_document_number(p_school_id, 'invoice', 'INV');

  insert into invoices (
    school_id, school_year_id, student_id, guardian_id, invoice_number,
    issue_date, due_date, status, total_amount, created_by
  ) values (
    p_school_id, p_school_year_id, p_student_id, p_guardian_id, v_invoice_number,
    current_date, v_due_date, 'issued', 0, p_actor_user_id
  ) returning id into v_invoice_id;

  for r in
    select fi.id, fi.label, fi.amount, fi.fee_schedule_id,
           fs.label as schedule_label, fs.total_amount as schedule_total
    from fee_installments fi
    join fee_schedules fs on fs.id = fi.fee_schedule_id
    where fi.id = any(p_fee_installment_ids)
  loop
    select * into v_assignment
    from student_fee_assignments
    where student_id = p_student_id and fee_schedule_id = r.fee_schedule_id;

    if not found then
      raise exception 'Aucun tarif affecté à l''élève pour le frais "%".', r.schedule_label;
    end if;

    if v_assignment.exemption then
      v_ratio := 0;
    elsif r.schedule_total > 0 then
      v_ratio := greatest(0, 1 - (v_assignment.discount_amount / r.schedule_total));
    else
      v_ratio := 1;
    end if;

    v_final_amount := round(r.amount * v_ratio, 2);
    v_total := v_total + v_final_amount;

    insert into invoice_items (school_id, invoice_id, fee_installment_id, description, quantity, unit_amount, amount)
    values (p_school_id, v_invoice_id, r.id, r.schedule_label || ' — ' || r.label, 1, v_final_amount, v_final_amount);
  end loop;

  update invoices set total_amount = v_total, updated_at = now() where id = v_invoice_id;

  return query select v_invoice_id, v_invoice_number, v_total;
end;
$$;

revoke all on function public.fn_create_invoice(uuid,uuid,uuid,uuid,uuid[],uuid) from public, anon, authenticated;
grant execute on function public.fn_create_invoice(uuid,uuid,uuid,uuid,uuid[],uuid) to service_role;

-- ---------- Annulation de facture (jamais de suppression physique) ----------
create or replace function public.fn_cancel_invoice(
  p_invoice_id uuid, p_school_id uuid, p_actor_user_id uuid, p_reason text
) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_invoice record;
begin
  select * into v_invoice from invoices where id = p_invoice_id and school_id = p_school_id for update;
  if not found then
    raise exception 'Facture introuvable pour cette école.';
  end if;
  if v_invoice.paid_amount > 0 then
    raise exception 'Impossible d''annuler une facture ayant déjà reçu des paiements confirmés ; utiliser un remboursement.';
  end if;
  if v_invoice.status = 'cancelled' then
    return;
  end if;

  update invoices
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_user_id,
      cancellation_reason = p_reason, updated_at = now()
  where id = p_invoice_id;
end;
$$;

revoke all on function public.fn_cancel_invoice(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.fn_cancel_invoice(uuid,uuid,uuid,text) to service_role;

-- ---------- Enregistrement d'un paiement (idempotent) ----------
create or replace function public.fn_record_payment(
  p_school_id uuid,
  p_school_year_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_currency text,
  p_payment_method text,
  p_reference text,
  p_payment_date date,
  p_idempotency_key text,
  p_recorded_by uuid,
  p_allocations jsonb
) returns table(out_payment_id uuid, out_payment_number text, out_status text)
language plpgsql security definer set search_path = public, app as $$
declare
  v_payment_id uuid;
  v_payment_number text;
  v_existing record;
  v_alloc jsonb;
  v_invoice_id uuid;
  v_alloc_amount numeric(12,2);
  v_sum_alloc numeric(12,2) := 0;
  v_invoice record;
begin
  -- Noms de colonnes de sortie préfixés (out_*) pour éviter toute ambiguïté
  -- avec les colonnes de la table payments dans les requêtes ci-dessous
  -- (PL/pgSQL expose les colonnes de RETURNS TABLE comme des variables du
  -- même nom dans tout le corps de la fonction).
  select id, payment_number, status into v_existing
  from payments where school_id = p_school_id and idempotency_key = p_idempotency_key;

  if found then
    return query select v_existing.id, v_existing.payment_number, v_existing.status;
    return;
  end if;

  if p_amount <= 0 then
    raise exception 'Le montant doit être strictement positif.';
  end if;
  if not exists (select 1 from students where id = p_student_id and school_id = p_school_id) then
    raise exception 'Élève introuvable pour cette école.';
  end if;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    v_invoice_id := (v_alloc ->> 'invoice_id')::uuid;
    v_alloc_amount := (v_alloc ->> 'amount')::numeric;

    if v_alloc_amount <= 0 then
      raise exception 'Le montant alloué doit être positif.';
    end if;

    select * into v_invoice from invoices
    where id = v_invoice_id and school_id = p_school_id and student_id = p_student_id
    for update;

    if not found then
      raise exception 'Facture invalide pour cette allocation.';
    end if;

    if v_alloc_amount > (v_invoice.total_amount - v_invoice.paid_amount) then
      raise exception 'Le montant alloué à la facture % dépasse son solde restant.', v_invoice.invoice_number;
    end if;

    v_sum_alloc := v_sum_alloc + v_alloc_amount;
  end loop;

  if v_sum_alloc > p_amount then
    raise exception 'La somme des allocations dépasse le montant du paiement.';
  end if;

  v_payment_number := app.next_document_number(p_school_id, 'payment', 'PAY');

  begin
    insert into payments (
      school_id, school_year_id, student_id, payment_number, amount, currency,
      payment_method, reference, payment_date, status, recorded_by, idempotency_key
    ) values (
      p_school_id, p_school_year_id, p_student_id, v_payment_number, p_amount, p_currency,
      p_payment_method, p_reference, p_payment_date, 'pending', p_recorded_by, p_idempotency_key
    ) returning id into v_payment_id;
  exception when unique_violation then
    -- Un appel concurrent avec la même idempotency_key a déjà créé le
    -- paiement : on renvoie celui-ci sans dupliquer les allocations.
    select id, payment_number, status into v_existing
    from payments where school_id = p_school_id and idempotency_key = p_idempotency_key;
    return query select v_existing.id, v_existing.payment_number, v_existing.status;
    return;
  end;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    insert into payment_allocations (school_id, payment_id, invoice_id, amount)
    values (p_school_id, v_payment_id, (v_alloc ->> 'invoice_id')::uuid, (v_alloc ->> 'amount')::numeric);
  end loop;

  return query select v_payment_id, v_payment_number, 'pending'::text;
end;
$$;

revoke all on function public.fn_record_payment(uuid,uuid,uuid,numeric,text,text,text,date,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.fn_record_payment(uuid,uuid,uuid,numeric,text,text,text,date,text,uuid,jsonb) to service_role;

-- ---------- Confirmation d'un paiement (idempotente) ----------
create or replace function public.fn_confirm_payment(p_payment_id uuid, p_school_id uuid, p_actor_user_id uuid)
returns table(out_payment_id uuid, already_confirmed boolean, status text)
language plpgsql security definer set search_path = public, app as $$
declare
  v_payment record;
begin
  select * into v_payment from payments where id = p_payment_id and school_id = p_school_id for update;

  if not found then
    raise exception 'Paiement introuvable pour cette école.';
  end if;

  if v_payment.status = 'confirmed' then
    return query select v_payment.id, true, v_payment.status;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'Seul un paiement en attente peut être confirmé (statut actuel : %).', v_payment.status;
  end if;

  update payments
  set status = 'confirmed', confirmed_by = p_actor_user_id, confirmed_at = now(), updated_at = now()
  where id = p_payment_id;

  return query select p_payment_id, false, 'confirmed'::text;
end;
$$;

revoke all on function public.fn_confirm_payment(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.fn_confirm_payment(uuid,uuid,uuid) to service_role;

-- ---------- Rejet d'un paiement (idempotent) ----------
create or replace function public.fn_reject_payment(
  p_payment_id uuid, p_school_id uuid, p_actor_user_id uuid, p_reason text
) returns table(out_payment_id uuid, already_rejected boolean, status text)
language plpgsql security definer set search_path = public, app as $$
declare
  v_payment record;
begin
  select * into v_payment from payments where id = p_payment_id and school_id = p_school_id for update;

  if not found then
    raise exception 'Paiement introuvable pour cette école.';
  end if;

  if v_payment.status = 'rejected' then
    return query select v_payment.id, true, v_payment.status;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'Seul un paiement en attente peut être rejeté (statut actuel : %).', v_payment.status;
  end if;

  update payments
  set status = 'rejected', rejected_by = p_actor_user_id, rejected_at = now(),
      rejection_reason = p_reason, updated_at = now()
  where id = p_payment_id;

  return query select p_payment_id, false, 'rejected'::text;
end;
$$;

revoke all on function public.fn_reject_payment(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.fn_reject_payment(uuid,uuid,uuid,text) to service_role;

-- ---------- Insertion idempotente d'un reçu ----------
-- Utilisée par l'Edge Function confirm-payment APRÈS génération du PDF :
-- la contrainte unique(payment_id) empêche toute double génération même
-- en cas de rejeu exact (ex: retry réseau après timeout côté client).
create or replace function public.fn_insert_receipt(
  p_school_id uuid, p_payment_id uuid, p_receipt_number text,
  p_pdf_storage_path text, p_issued_by uuid
) returns table(out_receipt_id uuid, already_existed boolean)
language plpgsql security definer set search_path = public, app as $$
declare
  v_receipt_id uuid;
  v_existing uuid;
begin
  select id into v_existing from receipts where payment_id = p_payment_id;
  if found then
    return query select v_existing, true;
    return;
  end if;

  begin
    insert into receipts (school_id, payment_id, receipt_number, pdf_storage_path, issued_by)
    values (p_school_id, p_payment_id, p_receipt_number, p_pdf_storage_path, p_issued_by)
    returning id into v_receipt_id;
  exception when unique_violation then
    select id into v_existing from receipts where payment_id = p_payment_id;
    return query select v_existing, true;
    return;
  end;

  return query select v_receipt_id, false;
end;
$$;

revoke all on function public.fn_insert_receipt(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.fn_insert_receipt(uuid,uuid,text,text,uuid) to service_role;
