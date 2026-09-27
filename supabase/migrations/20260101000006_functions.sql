-- ============================================================
-- Fonctions SECURITY DEFINER utilisées par les policies RLS.
-- search_path figé pour empêcher tout détournement.
-- ============================================================

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function app.school_role(p_school_id uuid) returns text
language sql stable security definer set search_path = public, app as $$
  select role from school_users
  where school_id = p_school_id and user_id = auth.uid() and status = 'active'
  limit 1;
$$;

create or replace function app.is_school_member(p_school_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from school_users
    where school_id = p_school_id and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function app.staff_has_permission(p_school_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce((permissions ->> p_permission)::boolean, false)
  from school_users
  where school_id = p_school_id and user_id = auth.uid()
    and role = 'admin_staff' and status = 'active'
  limit 1;
$$;

-- Élèves auxquels l'utilisateur courant a droit en tant que responsable.
-- p_financial_only = true : uniquement les élèves pour lesquels ce lien
-- autorise explicitement la réception des documents financiers.
create or replace function app.guardian_student_ids(p_financial_only boolean default false)
returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select sg.student_id
  from student_guardians sg
  join guardians g on g.id = sg.guardian_id
  where g.user_id = auth.uid()
    and sg.can_receive_notifications
    and (not p_financial_only or sg.can_receive_financial_documents);
$$;

-- Générique : maintien de updated_at
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Triggers updated_at listés explicitement (plutôt qu'une boucle dynamique
-- sur le catalogue) pour rester lisibles et auditables.
create trigger set_updated_at before update on schools
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on app_users
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on school_users
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on school_years
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on classes
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on students
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on guardians
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on fee_schedules
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on student_fee_assignments
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on invoices
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on payments
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on refunds
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on school_payment_methods
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on notification_channel_settings
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on reminder_rules
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on notifications
  for each row execute function app.set_updated_at();

-- Numérotation atomique de documents (facture/paiement/reçu) par école
create or replace function app.next_document_number(p_school_id uuid, p_doc_type text, p_prefix text)
returns text
language plpgsql security definer set search_path = public, app as $$
declare
  v_next bigint;
begin
  insert into document_sequences (school_id, doc_type, last_value)
  values (p_school_id, p_doc_type, 1)
  on conflict (school_id, doc_type)
  do update set last_value = document_sequences.last_value + 1
  returning last_value into v_next;

  return p_prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- Recalcule paid_amount/status d'une facture à partir des SEULS paiements
-- confirmés (jamais des paiements 'pending'). Source unique de vérité.
create or replace function app.recalc_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_total numeric(12,2);
  v_due date;
  v_status text;
  v_paid numeric(12,2);
begin
  select total_amount, due_date, status into v_total, v_due, v_status
  from invoices where id = p_invoice_id for update;

  if v_total is null then
    return;
  end if;

  select coalesce(sum(pa.amount), 0) into v_paid
  from payment_allocations pa
  join payments p on p.id = pa.payment_id
  where pa.invoice_id = p_invoice_id
    and p.status = 'confirmed';

  update invoices
  set paid_amount = v_paid,
      status = case
        when status in ('cancelled','draft') then status
        when v_paid >= v_total and v_total > 0 then 'paid'
        when v_paid > 0 then 'partially_paid'
        when v_due < current_date then 'overdue'
        else 'issued'
      end,
      updated_at = now()
  where id = p_invoice_id;
end;
$$;

-- Marquage quotidien des factures en retard (appelé par process-reminders)
create or replace function app.mark_overdue_invoices() returns void
language plpgsql security definer set search_path = public, app as $$
begin
  update invoices
  set status = 'overdue', updated_at = now()
  where status in ('issued','partially_paid')
    and due_date < current_date
    and paid_amount < total_amount;
end;
$$;
