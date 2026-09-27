-- ============================================================
-- Années scolaires, classes, élèves, responsables
-- ============================================================

create table school_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft','active','closed')),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, label),
  check (end_date > start_date)
);
create unique index one_current_school_year
  on school_years (school_id) where (is_current);

create table classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  name text not null,
  level text not null,
  capacity int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, school_year_id, name)
);

create table student_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_code text not null,
  first_name text not null,
  last_name text not null,
  dob date,
  gender text check (gender in ('M','F','other')),
  student_category_id uuid references student_categories(id),
  status text not null default 'active'
    check (status in ('active','transferred','graduated','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, student_code)
);
create index students_school_idx on students (school_id);

create table student_enrollments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  class_id uuid not null references classes(id),
  enrollment_date date not null default current_date,
  status text not null default 'enrolled'
    check (status in ('enrolled','transferred','withdrawn')),
  created_at timestamptz not null default now(),
  unique (student_id, school_year_id)
);
create index student_enrollments_class_idx on student_enrollments (class_id);

create table guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid references app_users(id),
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  preferred_channel text not null default 'whatsapp'
    check (preferred_channel in ('whatsapp','sms')),
  consent_whatsapp boolean not null default false,
  consent_sms boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index guardians_school_idx on guardians (school_id);
create index guardians_user_idx on guardians (user_id);

create table student_guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  guardian_id uuid not null references guardians(id) on delete cascade,
  relationship text not null check (relationship in ('father','mother','tutor','other')),
  is_primary boolean not null default false,
  can_receive_notifications boolean not null default true,
  can_receive_financial_documents boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, guardian_id)
);
create index student_guardians_guardian_idx on student_guardians (guardian_id);
create index student_guardians_student_idx on student_guardians (student_id);
