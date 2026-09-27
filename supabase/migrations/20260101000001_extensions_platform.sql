-- Extensions & schéma applicatif
create extension if not exists pgcrypto;

create schema if not exists app;

-- ============================================================
-- Écoles (tenants)
-- ============================================================
create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country text not null default 'BJ',
  timezone text not null default 'Africa/Porto-Novo',
  currency text not null default 'XOF',
  status text not null default 'active'
    check (status in ('trial','active','suspended','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profil applicatif, miroir 1-1 de auth.users
create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  locale text not null default 'fr',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Super-administrateurs SaaS (table dédiée pour traçabilité, jamais un flag)
create table platform_admins (
  user_id uuid primary key references app_users(id) on delete cascade,
  granted_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

-- Rattachement utilisateur <-> école avec rôle et permissions fines
create table school_users (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null check (role in ('director','accountant','admin_staff','parent')),
  permissions jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('invited','active','suspended')),
  invited_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id, role)
);
create index school_users_user_idx on school_users (user_id);
create index school_users_school_idx on school_users (school_id);

-- Création automatique du profil app_users à l'inscription Supabase Auth
create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  insert into app_users (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'Utilisateur'),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app.handle_new_auth_user();
