-- ============================================================
-- Row Level Security : activation + policies pour toutes les tables
-- métier. Principe : aucune policy INSERT/UPDATE/DELETE cliente sur les
-- tables financières sensibles -> ces opérations passent exclusivement
-- par des Edge Functions (service_role, qui contourne RLS après avoir
-- revalidé le rôle réel de l'appelant depuis la base).
-- ============================================================

-- ---------- schools ----------
alter table schools enable row level security;

create policy schools_select on schools for select using (
  app.is_super_admin() or app.is_school_member(id)
);
create policy schools_update on schools for update using (
  app.school_role(id) = 'director'
) with check (
  app.school_role(id) = 'director'
);

-- ---------- app_users ----------
alter table app_users enable row level security;

create policy app_users_select on app_users for select using (
  auth.uid() = id
  or app.is_super_admin()
  or exists (
    select 1 from school_users su
    where su.user_id = auth.uid() and su.status = 'active'
      and su.role in ('director','accountant','admin_staff')
      and exists (
        select 1 from school_users su2
        where su2.user_id = app_users.id and su2.school_id = su.school_id and su2.status = 'active'
      )
  )
);
create policy app_users_update_self on app_users for update using (
  auth.uid() = id
) with check (
  auth.uid() = id
);

-- ---------- platform_admins ----------
alter table platform_admins enable row level security;
alter table platform_admins force row level security;

create policy platform_admins_select on platform_admins for select using (
  app.is_super_admin()
);
-- Aucune policy d'écriture cliente : la nomination d'un super admin est une
-- opération hors application, réalisée directement en base par l'équipe
-- infra, jamais via l'API cliente.

-- ---------- school_users ----------
alter table school_users enable row level security;
alter table school_users force row level security;

create policy school_users_select on school_users for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant','admin_staff')
  or user_id = auth.uid()
);
-- Aucune policy insert/update/delete cliente : rôle et rattachement école
-- gérés exclusivement par les Edge Functions invite-school-user /
-- accept-invite / change-user-role. Impossible pour un utilisateur de
-- modifier son propre role ou school_id depuis le navigateur.

-- ---------- school_years ----------
alter table school_years enable row level security;

create policy school_years_select on school_years for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant','admin_staff')
);
create policy school_years_insert on school_years for insert with check (
  app.school_role(school_id) = 'director'
);
create policy school_years_update on school_years for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

-- ---------- classes ----------
alter table classes enable row level security;

create policy classes_select on classes for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant','admin_staff')
  or id in (select se.class_id from student_enrollments se where se.student_id in (select app.guardian_student_ids()))
);
create policy classes_insert on classes for insert with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_classes')
);
create policy classes_update on classes for update using (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_classes')
) with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_classes')
);

-- ---------- student_categories ----------
alter table student_categories enable row level security;

create policy student_categories_select on student_categories for select using (
  app.school_role(school_id) in ('director','accountant','admin_staff')
);
create policy student_categories_write on student_categories for insert with check (
  app.school_role(school_id) = 'director'
);
create policy student_categories_update on student_categories for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

-- ---------- students ----------
alter table students enable row level security;

create policy students_select on students for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant','admin_staff')
  or id in (select app.guardian_student_ids())
);
create policy students_insert on students for insert with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_students')
);
create policy students_update on students for update using (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_students')
) with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_students')
);

-- ---------- student_enrollments ----------
alter table student_enrollments enable row level security;

create policy student_enrollments_select on student_enrollments for select using (
  app.school_role(school_id) in ('director','accountant','admin_staff')
  or student_id in (select app.guardian_student_ids())
);
create policy student_enrollments_insert on student_enrollments for insert with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_students')
);
create policy student_enrollments_update on student_enrollments for update using (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_students')
) with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_students')
);

-- ---------- guardians ----------
alter table guardians enable row level security;

create policy guardians_select on guardians for select using (
  app.school_role(school_id) in ('director','accountant','admin_staff')
  or user_id = auth.uid()
);
create policy guardians_insert on guardians for insert with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_guardians')
);
create policy guardians_update on guardians for update using (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_guardians')
  or user_id = auth.uid()
) with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_guardians')
  or user_id = auth.uid()
);

-- ---------- student_guardians ----------
alter table student_guardians enable row level security;

create policy student_guardians_select on student_guardians for select using (
  app.school_role(school_id) in ('director','accountant','admin_staff')
  or guardian_id in (select g.id from guardians g where g.user_id = auth.uid())
);
-- Écriture réservée au staff autorisé : un responsable ne doit jamais
-- pouvoir s'auto-accorder can_receive_financial_documents.
create policy student_guardians_insert on student_guardians for insert with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_guardians')
);
create policy student_guardians_update on student_guardians for update using (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_guardians')
) with check (
  app.school_role(school_id) = 'director'
  or app.staff_has_permission(school_id, 'manage_guardians')
);

-- ---------- fee_categories / fee_schedules / fee_installments ----------
-- Paramètres financiers : lecture staff, écriture directeur uniquement
-- (§3 : le comptable n'a pas automatiquement les droits du directeur).
alter table fee_categories enable row level security;
create policy fee_categories_select on fee_categories for select using (
  app.school_role(school_id) in ('director','accountant','admin_staff')
);
create policy fee_categories_insert on fee_categories for insert with check (
  app.school_role(school_id) = 'director'
);
create policy fee_categories_update on fee_categories for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

alter table fee_schedules enable row level security;
create policy fee_schedules_select on fee_schedules for select using (
  app.school_role(school_id) in ('director','accountant','admin_staff')
);
create policy fee_schedules_insert on fee_schedules for insert with check (
  app.school_role(school_id) = 'director'
);
create policy fee_schedules_update on fee_schedules for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

alter table fee_installments enable row level security;
create policy fee_installments_select on fee_installments for select using (
  app.school_role(school_id) in ('director','accountant','admin_staff')
);
create policy fee_installments_insert on fee_installments for insert with check (
  app.school_role(school_id) = 'director'
);
create policy fee_installments_update on fee_installments for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

-- ---------- student_fee_assignments ----------
alter table student_fee_assignments enable row level security;

create policy student_fee_assignments_select on student_fee_assignments for select using (
  app.school_role(school_id) in ('director','accountant','admin_staff')
  or student_id in (select app.guardian_student_ids(true))
);
create policy student_fee_assignments_insert on student_fee_assignments for insert with check (
  app.school_role(school_id) = 'director'
);
create policy student_fee_assignments_update on student_fee_assignments for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

-- ---------- invoices / invoice_items ----------
-- Aucune policy insert/update cliente : create-invoice / cancel-invoice
-- (Edge Functions) recalculent et écrivent tout côté serveur.
alter table invoices enable row level security;
alter table invoices force row level security;

create policy invoices_select on invoices for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant')
  or student_id in (select app.guardian_student_ids(true))
);

alter table invoice_items enable row level security;

create policy invoice_items_select on invoice_items for select using (
  app.school_role(school_id) in ('director','accountant')
  or invoice_id in (
    select i.id from invoices i where i.student_id in (select app.guardian_student_ids(true))
  )
);

-- ---------- payments / payment_allocations ----------
-- Aucune policy insert/update cliente : record-payment / confirm-payment /
-- reject-payment (Edge Functions) uniquement.
alter table payments enable row level security;
alter table payments force row level security;

create policy payments_select on payments for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant')
  or (status = 'confirmed' and student_id in (select app.guardian_student_ids(true)))
);

alter table payment_allocations enable row level security;

create policy payment_allocations_select on payment_allocations for select using (
  app.school_role(school_id) in ('director','accountant')
  or payment_id in (
    select p.id from payments p
    where p.status = 'confirmed' and p.student_id in (select app.guardian_student_ids(true))
  )
);

-- ---------- receipts ----------
-- Aucune policy insert/update cliente : uniquement confirm-payment (Edge
-- Function) crée un reçu, jamais de régénération/modification silencieuse.
alter table receipts enable row level security;
alter table receipts force row level security;

create policy receipts_select on receipts for select using (
  app.school_role(school_id) in ('director','accountant')
  or payment_id in (
    select p.id from payments p
    where p.status = 'confirmed' and p.student_id in (select app.guardian_student_ids(true))
  )
);

-- ---------- refunds ----------
alter table refunds enable row level security;
alter table refunds force row level security;

create policy refunds_select on refunds for select using (
  app.school_role(school_id) in ('director','accountant')
);
-- Écriture uniquement via request-refund / approve-refund (Edge Functions).

-- ---------- school_payment_methods ----------
alter table school_payment_methods enable row level security;

create policy school_payment_methods_select on school_payment_methods for select using (
  app.is_school_member(school_id)
);
create policy school_payment_methods_insert on school_payment_methods for insert with check (
  app.school_role(school_id) = 'director'
);
create policy school_payment_methods_update on school_payment_methods for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

-- ---------- notification_channel_settings ----------
alter table notification_channel_settings enable row level security;

create policy notification_channel_settings_select on notification_channel_settings for select using (
  app.school_role(school_id) in ('director','accountant')
);
create policy notification_channel_settings_insert on notification_channel_settings for insert with check (
  app.school_role(school_id) = 'director'
);
create policy notification_channel_settings_update on notification_channel_settings for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

-- ---------- reminder_rules ----------
alter table reminder_rules enable row level security;

create policy reminder_rules_select on reminder_rules for select using (
  app.school_role(school_id) in ('director','accountant')
);
create policy reminder_rules_insert on reminder_rules for insert with check (
  app.school_role(school_id) = 'director'
);
create policy reminder_rules_update on reminder_rules for update using (
  app.school_role(school_id) = 'director'
) with check (
  app.school_role(school_id) = 'director'
);

-- ---------- notifications ----------
-- Aucune policy insert/update cliente : uniquement process-reminders /
-- send-notification-worker / confirm-payment (Edge Functions + cron).
alter table notifications enable row level security;

create policy notifications_select on notifications for select using (
  app.school_role(school_id) in ('director','accountant')
  or guardian_id in (select g.id from guardians g where g.user_id = auth.uid())
);

-- ---------- document_access_logs ----------
alter table document_access_logs enable row level security;

create policy document_access_logs_select on document_access_logs for select using (
  app.is_super_admin() or app.school_role(school_id) = 'director'
);
-- Écriture uniquement par generate-document-url (Edge Function).

-- ---------- audit_logs ----------
alter table audit_logs enable row level security;
alter table audit_logs force row level security;

create policy audit_logs_select on audit_logs for select using (
  app.is_super_admin()
  or (school_id is not null and app.school_role(school_id) = 'director')
);
-- Aucune policy write cliente. Les seules écritures proviennent des
-- triggers (SECURITY DEFINER, propriétaire de la table) et des Edge
-- Functions (service_role) ; update/delete déjà révoqués en 0005.

-- ---------- document_sequences ----------
-- Table technique interne : aucun accès client direct (lecture ou
-- écriture), uniquement via app.next_document_number() (SECURITY DEFINER).
alter table document_sequences enable row level security;
