-- ============================================================
-- Factures, paiements, reçus, remboursements, numérotation
-- ============================================================

create table document_sequences (
  school_id uuid not null references schools(id) on delete cascade,
  doc_type text not null check (doc_type in ('invoice','payment','receipt')),
  last_value bigint not null default 0,
  primary key (school_id, doc_type)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id),
  student_id uuid not null references students(id),
  guardian_id uuid references guardians(id),
  invoice_number text not null,
  issue_date date not null default current_date,
  due_date date not null,
  status text not null default 'draft'
    check (status in ('draft','issued','partially_paid','paid','overdue','cancelled')),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  currency text not null default 'XOF',
  notes text,
  cancelled_at timestamptz,
  cancelled_by uuid references app_users(id),
  cancellation_reason text,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, invoice_number),
  check (paid_amount <= total_amount)
);
create index invoices_school_student_idx on invoices (school_id, student_id);
create index invoices_school_status_idx on invoices (school_id, status);
create index invoices_due_date_idx on invoices (due_date);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  fee_installment_id uuid references fee_installments(id),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_amount numeric(12,2) not null,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on invoice_items (invoice_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id),
  student_id uuid not null references students(id),
  payment_number text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'XOF',
  payment_method text not null
    check (payment_method in ('cash','mobile_money','bank_transfer','cheque','other')),
  reference text,
  payment_date date not null default current_date,
  status text not null default 'pending'
    check (status in ('pending','confirmed','rejected','cancelled')),
  recorded_by uuid not null references app_users(id),
  confirmed_by uuid references app_users(id),
  confirmed_at timestamptz,
  rejected_by uuid references app_users(id),
  rejected_at timestamptz,
  rejection_reason text,
  idempotency_key text not null,
  external_provider text,
  external_transaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, payment_number),
  unique (school_id, idempotency_key)
);
create unique index payments_external_txn_unique
  on payments (external_provider, external_transaction_id)
  where external_transaction_id is not null;
create index payments_school_student_idx on payments (school_id, student_id);
create index payments_school_status_idx on payments (school_id, status);

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade,
  invoice_id uuid not null references invoices(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index payment_allocations_payment_idx on payment_allocations (payment_id);
create index payment_allocations_invoice_idx on payment_allocations (invoice_id);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  payment_id uuid not null references payments(id),
  receipt_number text not null,
  pdf_storage_path text not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references app_users(id),
  voided boolean not null default false,
  voided_at timestamptz,
  voided_by uuid references app_users(id),
  void_reason text,
  created_at timestamptz not null default now(),
  unique (school_id, receipt_number),
  unique (payment_id)
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  payment_id uuid not null references payments(id),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','completed')),
  requested_by uuid not null references app_users(id),
  approved_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table school_payment_methods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  type text not null check (type in ('cash','mobile_money','bank_transfer','other')),
  label text not null,
  details jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
