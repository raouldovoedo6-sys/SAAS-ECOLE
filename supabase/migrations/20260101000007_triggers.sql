-- ============================================================
-- Triggers d'intégrité financière et d'audit automatique
-- ============================================================

-- La somme des tranches d'un tarif ne doit jamais dépasser le montant total
-- (les tranches peuvent être ajoutées progressivement, donc pas d'égalité
-- stricte imposée ici ; la cohérence finale est vérifiée à la génération
-- de facture par l'Edge Function create-invoice).
create or replace function app.trg_fee_installments_check() returns trigger
language plpgsql set search_path = public, app as $$
declare
  v_schedule_id uuid;
  v_total numeric(12,2);
  v_sum numeric(12,2);
begin
  v_schedule_id := coalesce(new.fee_schedule_id, old.fee_schedule_id);
  select total_amount into v_total from fee_schedules where id = v_schedule_id;
  select coalesce(sum(amount), 0) into v_sum
  from fee_installments where fee_schedule_id = v_schedule_id;

  if v_sum > v_total then
    raise exception 'La somme des tranches (%) dépasse le montant total du tarif (%)', v_sum, v_total;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger fee_installments_check
after insert or update or delete on fee_installments
for each row execute function app.trg_fee_installments_check();

-- La somme des allocations d'un paiement ne doit jamais dépasser son montant
create or replace function app.trg_payment_allocations_check() returns trigger
language plpgsql set search_path = public, app as $$
declare
  v_payment_id uuid;
  v_amount numeric(12,2);
  v_sum numeric(12,2);
begin
  v_payment_id := coalesce(new.payment_id, old.payment_id);
  select amount into v_amount from payments where id = v_payment_id;
  select coalesce(sum(amount), 0) into v_sum
  from payment_allocations where payment_id = v_payment_id;

  if v_sum > v_amount then
    raise exception 'La somme des allocations (%) dépasse le montant du paiement (%)', v_sum, v_amount;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger payment_allocations_check
after insert or update on payment_allocations
for each row execute function app.trg_payment_allocations_check();

-- Recalcul automatique du solde de facture quand les allocations changent
create or replace function app.trg_payment_allocations_recalc() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if TG_OP = 'DELETE' then
    perform app.recalc_invoice(old.invoice_id);
    return old;
  else
    perform app.recalc_invoice(new.invoice_id);
    if TG_OP = 'UPDATE' and old.invoice_id is distinct from new.invoice_id then
      perform app.recalc_invoice(old.invoice_id);
    end if;
    return new;
  end if;
end;
$$;

create trigger payment_allocations_recalc
after insert or update or delete on payment_allocations
for each row execute function app.trg_payment_allocations_recalc();

-- Recalcul automatique quand un paiement change de statut
-- (confirmed/rejected/cancelled) : les factures concernées sont recalculées.
create or replace function app.trg_payments_status_recalc() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  r record;
begin
  if old.status is distinct from new.status then
    for r in select invoice_id from payment_allocations where payment_id = new.id loop
      perform app.recalc_invoice(r.invoice_id);
    end loop;
  end if;
  return new;
end;
$$;

create trigger payments_status_recalc
after update on payments
for each row execute function app.trg_payments_status_recalc();

-- Audit automatique : changement de rôle/statut d'un school_users.
-- auth.uid() est renseigné ici car cette table reste modifiable par le
-- client (Edge Function change-user-role) via PostgREST avec le JWT de
-- l'appelant ; les opérations service_role passeront explicitement
-- actor_user_id dans leur propre insertion d'audit_logs applicative.
create or replace function app.trg_audit_school_users() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if old.role is distinct from new.role or old.status is distinct from new.status then
    insert into audit_logs (school_id, actor_user_id, action, entity_type, entity_id, old_value, new_value)
    values (
      new.school_id, auth.uid(), 'school_users.role_or_status_change', 'school_users', new.id,
      jsonb_build_object('role', old.role, 'status', old.status),
      jsonb_build_object('role', new.role, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger audit_school_users
after update on school_users
for each row execute function app.trg_audit_school_users();

-- Audit automatique : réduction/exonération sur une affectation de frais
create or replace function app.trg_audit_student_fee_assignments() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if old.discount_amount is distinct from new.discount_amount
     or old.exemption is distinct from new.exemption
     or old.discount_status is distinct from new.discount_status then
    insert into audit_logs (school_id, actor_user_id, action, entity_type, entity_id, old_value, new_value, reason)
    values (
      new.school_id, auth.uid(), 'student_fee_assignment.discount_change', 'student_fee_assignments', new.id,
      jsonb_build_object('discount_amount', old.discount_amount, 'exemption', old.exemption, 'discount_status', old.discount_status),
      jsonb_build_object('discount_amount', new.discount_amount, 'exemption', new.exemption, 'discount_status', new.discount_status),
      new.discount_reason
    );
  end if;
  return new;
end;
$$;

create trigger audit_student_fee_assignments
after update on student_fee_assignments
for each row execute function app.trg_audit_student_fee_assignments();
