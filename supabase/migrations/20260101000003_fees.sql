-- ============================================================
-- Catégories de frais, tarifs, tranches, affectations aux élèves
-- ============================================================

create table fee_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, code)
);

create table fee_schedules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  fee_category_id uuid not null references fee_categories(id),
  class_id uuid references classes(id),
  level text,
  student_category_id uuid references student_categories(id),
  label text not null,
  total_amount numeric(12,2) not null check (total_amount >= 0),
  currency text not null default 'XOF',
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fee_schedules_school_year_idx on fee_schedules (school_id, school_year_id);

create table fee_installments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  fee_schedule_id uuid not null references fee_schedules(id) on delete cascade,
  label text not null,
  sequence int not null,
  amount numeric(12,2) not null check (amount >= 0),
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (fee_schedule_id, sequence)
);

-- Affectation d'un tarif à un élève pour l'année, avec réduction/exonération
create table student_fee_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  fee_schedule_id uuid not null references fee_schedules(id),
  base_amount numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  discount_reason text,
  discount_status text not null default 'none'
    check (discount_status in ('none','pending_approval','approved','rejected')),
  discount_approved_by uuid references app_users(id),
  discount_approved_at timestamptz,
  exemption boolean not null default false,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, fee_schedule_id),
  check (discount_amount <= base_amount)
);
create index student_fee_assignments_student_idx on student_fee_assignments (student_id);
