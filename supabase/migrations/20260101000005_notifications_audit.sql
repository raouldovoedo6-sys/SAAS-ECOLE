-- ============================================================
-- Rappels, notifications, journaux d'accès et d'audit
-- ============================================================

create table notification_channel_settings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','sms')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, channel)
);

create table reminder_rules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  offset_days int not null,
  channel text not null check (channel in ('whatsapp','sms','both')),
  template_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid references students(id),
  guardian_id uuid references guardians(id),
  invoice_id uuid references invoices(id),
  payment_id uuid references payments(id),
  reminder_rule_id uuid references reminder_rules(id),
  channel text not null check (channel in ('whatsapp','sms')),
  type text not null check (type in ('invoice','reminder','receipt','other')),
  template_name text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'scheduled'
    check (status in ('scheduled','queued','sent','delivered','failed','cancelled')),
  idempotency_key text not null,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, idempotency_key)
);
create index notifications_school_status_idx on notifications (school_id, status);
create index notifications_scheduled_for_idx on notifications (scheduled_for);

create table document_access_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid references app_users(id),
  document_type text not null check (document_type in ('invoice','receipt')),
  document_id uuid not null,
  action text not null check (action in ('view','download','signed_url_issued')),
  created_at timestamptz not null default now()
);
create index document_access_logs_doc_idx on document_access_logs (document_type, document_id);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id),
  actor_user_id uuid references app_users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_school_created_idx on audit_logs (school_id, created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);

-- Personne (y compris service_role via un rôle applicatif) ne doit pouvoir
-- modifier ou supprimer un log d'audit une fois écrit. On révoque tout,
-- même si aucune policy RLS ne l'autorisait déjà par défaut : défense en
-- profondeur explicite.
revoke update, delete on audit_logs from authenticated, anon;
