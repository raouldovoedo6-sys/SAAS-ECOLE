# SaaS Frais Scolaires — Architecture (avant implémentation)

Document de référence, à valider avant génération du code. Suit l'ordre demandé :
1. Architecture générale — 2. Schéma DB — 3. Relations — 4. Stratégie RLS —
5. Workflows — 6. Edge Functions — 7. Organisation frontend — 8. Sécurité & tests.

---

## Étape 1 — Architecture générale

```
                        ┌─────────────────────────────┐
                        │   Netlify (frontend PWA)      │
                        │   React + TS, statique         │
                        └───────────────┬───────────────┘
                                        │ HTTPS (anon key, JWT utilisateur)
                                        ▼
                        ┌─────────────────────────────┐
                        │        Supabase Auth          │
                        │  (JWT: sub=user_id, pas de     │
                        │   claim school_id/role dans   │
                        │   le JWT — voir §4)            │
                        └───────────────┬───────────────┘
                                        │
              ┌────────────────────────┼─────────────────────────┐
              ▼                        ▼                         ▼
   ┌────────────────────┐   ┌───────────────────────┐  ┌─────────────────────┐
   │ PostgREST (via      │   │  Edge Functions        │  │ Supabase Storage      │
   │ supabase-js), RLS   │   │  (service_role, Deno)   │  │ buckets privés        │
   │ appliqué sur CHAQUE │   │  logique métier sensible│  │ invoices/, receipts/  │
   │ requête              │   │  (paiements, reçus,     │  │ URLs signées, TTL     │
   └────────────────────┘   │  notifications, PDF)    │  └─────────────────────┘
                             └───────────┬─────────────┘
                                        │
                        ┌───────────────┼────────────────┐
                        ▼                                ▼
              ┌─────────────────┐              ┌───────────────────────┐
              │  PostgreSQL      │              │ Prestataires externes  │
              │  (source de       │              │ - Email transactionnel │
              │   vérité + RLS +  │              │ - WhatsApp Business API│
              │   triggers +      │              │ (secrets = Supabase    │
              │   contraintes)    │              │  Edge Function secrets)│
              └─────────────────┘              └───────────────────────┘
                        ▲
                        │ cron (pg_cron ou Supabase Scheduled Functions)
              ┌─────────────────────┐
              │ process-reminders    │
              │ send-notification    │
              └─────────────────────┘
```

**Principes structurants**

- **Multi-tenant strict** : `school_id` sur chaque table métier. Aucune table
  métier n'est accessible sans passer par une politique RLS qui revérifie
  l'appartenance de l'utilisateur à l'école, à partir de tables serveur
  (`school_users`, `student_guardians`), jamais à partir d'une donnée envoyée
  par le client.
- **Le frontend ne fait aucune vérification de sécurité** : il peut cacher un
  bouton ou filtrer un affichage pour l'UX, mais toute lecture/écriture passe
  par RLS (PostgREST) ou par une Edge Function qui revalide tout côté serveur.
- **Deux surfaces d'accès aux données** :
  - Lectures et écritures simples/non sensibles → PostgREST + RLS directement
    (ex: lister ses propres élèves quand on est directeur).
  - Opérations sensibles ou multi-étapes (paiement, confirmation, reçu,
    notification, remboursement, changement de rôle) → **toujours** une Edge
    Function avec `service_role`, qui : authentifie le JWT utilisateur reçu,
    recharge son rôle réel depuis la DB, revalide tous les montants/état,
    exécute dans une transaction, écrit l'audit log.
- **Aucun secret côté frontend** : clé `service_role`, clés WhatsApp, clé
  fournisseur email → uniquement dans les secrets des Edge Functions
  (`supabase secrets set`), jamais dans le bundle Netlify.
- **PWA mobile-first** : Vite + React + TS, `vite-plugin-pwa`, design mobile
  d'abord, responsive ensuite pour desktop (dashboard direction).

---

## Étape 2 — Schéma PostgreSQL complet

Conventions : toutes les tables ont `id uuid primary key default gen_random_uuid()`,
`created_at timestamptz not null default now()`. Les tables métier ont
`school_id uuid not null references schools(id)`. Montants en `numeric(12,2)`.
Devise par défaut `XOF`.

### 2.1 Plateforme & identité

```sql
-- Écoles (tenants)
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

-- Profil utilisateur applicatif, miroir de auth.users
create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  locale text not null default 'fr',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Super-administrateurs SaaS (jamais un booléen sur app_users : traçabilité)
create table platform_admins (
  user_id uuid primary key references app_users(id),
  granted_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

-- Rattachement utilisateur <-> école avec rôle. Un user peut appartenir
-- à plusieurs écoles (ex: comptable freelance) avec un rôle par école.
create table school_users (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null check (role in ('director','accountant','admin_staff','parent')),
  permissions jsonb not null default '{}'::jsonb, -- overrides fins pour admin_staff
  status text not null default 'active' check (status in ('invited','active','suspended')),
  invited_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id, role)
);
create index on school_users (user_id);
create index on school_users (school_id);
```

### 2.2 Années scolaires, classes, élèves, responsables

```sql
create table school_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  label text not null,               -- '2026-2027'
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft','active','closed')),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, label),
  check (end_date > start_date)
);
-- Un seul school_year courant par école (index partiel)
create unique index one_current_school_year
  on school_years (school_id) where (is_current);

create table classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  name text not null,                -- 'CM2 A'
  level text not null,                -- 'CM2'
  capacity int,
  created_at timestamptz not null default now(),
  unique (school_id, school_year_id, name)
);

create table student_categories ( -- 'ordinaire', 'boursier', etc.
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
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

-- Inscription d'un élève dans une classe pour une année scolaire donnée
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

create table guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid references app_users(id),  -- null si pas encore de compte
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  preferred_channel text not null default 'whatsapp'
    check (preferred_channel in ('whatsapp','email','sms')),
  consent_whatsapp boolean not null default false,
  consent_email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table student_guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade, -- dénormalisé pour RLS
  student_id uuid not null references students(id) on delete cascade,
  guardian_id uuid not null references guardians(id) on delete cascade,
  relationship text not null check (relationship in ('father','mother','tutor','other')),
  is_primary boolean not null default false,
  can_receive_notifications boolean not null default true,
  can_receive_financial_documents boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, guardian_id)
);
create index on student_guardians (guardian_id);
create index on student_guardians (student_id);
```

### 2.3 Tarifs, échéances, affectations

```sql
create table fee_categories ( -- scolarité, inscription, cantine, transport...
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  code text not null,          -- 'tuition','registration','canteen',...
  name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, code)
);

create table fee_schedules ( -- un tarif défini pour une année/catégorie/niveau
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  fee_category_id uuid not null references fee_categories(id),
  class_id uuid references classes(id),           -- null = toutes les classes du niveau
  level text,                                      -- alternative à class_id
  student_category_id uuid references student_categories(id), -- null = tous
  label text not null,
  total_amount numeric(12,2) not null check (total_amount >= 0),
  currency text not null default 'XOF',
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fee_installments ( -- tranches
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  fee_schedule_id uuid not null references fee_schedules(id) on delete cascade,
  label text not null,          -- '1re tranche'
  sequence int not null,
  amount numeric(12,2) not null check (amount >= 0),
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (fee_schedule_id, sequence)
);
-- Trigger applicatif : somme(fee_installments.amount) doit == fee_schedules.total_amount
-- (contrainte inter-lignes, non exprimable en CHECK simple ; voir §2.6)

-- Affectation d'un tarif à un élève pour l'année, avec éventuelle réduction/exonération
create table student_fee_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  fee_schedule_id uuid not null references fee_schedules(id),
  base_amount numeric(12,2) not null,             -- snapshot du tarif au moment de l'affectation
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  discount_reason text,
  discount_status text not null default 'none'
    check (discount_status in ('none','pending_approval','approved','rejected')),
  discount_approved_by uuid references app_users(id),
  discount_approved_at timestamptz,
  exemption boolean not null default false,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  unique (student_id, fee_schedule_id)
);
```

### 2.4 Factures, paiements, reçus, remboursements

```sql
create table invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  school_year_id uuid not null references school_years(id),
  student_id uuid not null references students(id),
  guardian_id uuid references guardians(id),  -- destinataire principal de la facture
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
create index on invoices (school_id, student_id);
create index on invoices (school_id, status);

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
  idempotency_key text not null,          -- anti double-soumission client
  external_provider text,                  -- futur paiement en ligne
  external_transaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, payment_number),
  unique (school_id, idempotency_key)
);
create unique index payments_external_txn_unique
  on payments (external_provider, external_transaction_id)
  where external_transaction_id is not null;
create index on payments (school_id, student_id);
create index on payments (school_id, status);

create table payment_allocations ( -- répartition d'un paiement sur une ou plusieurs factures
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade,
  invoice_id uuid not null references invoices(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index on payment_allocations (payment_id);
create index on payment_allocations (invoice_id);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  payment_id uuid not null references payments(id),
  receipt_number text not null,
  pdf_storage_path text not null,  -- bucket privé 'receipts'
  issued_at timestamptz not null default now(),
  issued_by uuid references app_users(id),
  voided boolean not null default false,
  voided_at timestamptz,
  voided_by uuid references app_users(id),
  void_reason text,
  created_at timestamptz not null default now(),
  unique (school_id, receipt_number),
  unique (payment_id)   -- 1 reçu par paiement confirmé, jamais régénéré silencieusement
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
```

### 2.5 Rappels, notifications, moyens de paiement officiels, audit

```sql
create table school_payment_methods ( -- moyens officiels communiqués aux parents
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  type text not null check (type in ('cash','mobile_money','bank_transfer','other')),
  label text not null,
  details jsonb not null default '{}'::jsonb, -- infos non sensibles (numéro à afficher)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table notification_channel_settings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb, -- références non secrètes (sender id...)
  created_at timestamptz not null default now(),
  unique (school_id, channel)
);

create table reminder_rules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  offset_days int not null,     -- -7, -2, 0, +3 ...
  channel text not null check (channel in ('whatsapp','email','both')),
  template_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid references students(id),
  guardian_id uuid references guardians(id),
  invoice_id uuid references invoices(id),
  payment_id uuid references payments(id),
  reminder_rule_id uuid references reminder_rules(id),
  channel text not null check (channel in ('whatsapp','email')),
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
create index on notifications (school_id, status);

create table document_access_logs ( -- traçabilité des téléchargements sensibles
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid references app_users(id),
  document_type text not null check (document_type in ('invoice','receipt')),
  document_id uuid not null,
  action text not null check (action in ('view','download','signed_url_issued')),
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id),      -- null = action plateforme (super-admin)
  actor_user_id uuid references app_users(id),-- null = job système/cron
  action text not null,                        -- 'payment.confirm', 'role.change', ...
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index on audit_logs (school_id, created_at desc);
create index on audit_logs (entity_type, entity_id);
```

### 2.6 Triggers d'intégrité (résumé, DDL complète à l'implémentation)

- `trg_fee_installments_sum` : `AFTER INSERT/UPDATE/DELETE` sur `fee_installments`
  → vérifie `sum(amount) = fee_schedules.total_amount` pour le `fee_schedule_id`
  concerné ; lève une exception sinon.
- `trg_payment_allocations_sum` : empêche que la somme des allocations d'un
  paiement dépasse `payments.amount`.
- `trg_invoices_paid_amount` : recalcule `invoices.paid_amount` et `status`
  à partir de la somme des `payment_allocations` liées à des `payments`
  **confirmés uniquement** (jamais `pending`) → source unique de vérité,
  jamais mis à jour directement par le client.
- `trg_audit_*` : triggers `AFTER UPDATE` sur `invoices`, `payments`,
  `school_users`, `student_fee_assignments` (rôle, montants, réductions)
  qui écrivent automatiquement dans `audit_logs`.
- Toutes les tables `updated_at` : trigger générique `set_updated_at()`.

---

## Étape 3 — Relations entre les tables (vue d'ensemble)

```
schools 1───∞ school_users ∞───1 app_users
schools 1───∞ school_years 1───∞ classes
schools 1───∞ students 1───∞ student_enrollments ∞───1 classes
students ∞───∞ guardians   (via student_guardians, avec droits par lien)
schools 1───∞ fee_categories 1───∞ fee_schedules 1───∞ fee_installments
students 1───∞ student_fee_assignments ∞───1 fee_schedules
students 1───∞ invoices 1───∞ invoice_items ∞───1 fee_installments
students 1───∞ payments 1───∞ payment_allocations ∞───1 invoices
payments 1───1 receipts
payments 1───∞ refunds
schools 1───∞ reminder_rules 1───∞ notifications
students/guardians/invoices/payments ∞───∞ notifications (références nullable)
Tout écriture sensible ───> audit_logs (append-only)
```

Points clés :
- `student_guardians` est la seule table qui autorise un parent à voir un
  élève et ses documents financiers ; **aucune** autre table ne doit être
  interrogée directement par un rôle `parent`.
- `payments.status = confirmed` est la **seule** source qui alimente
  `invoices.paid_amount` (trigger), jamais une écriture directe.
- `receipts` est en 1-1 avec `payments` confirmés : impossible d'avoir un
  reçu sans paiement confirmé (contrainte + logique Edge Function).
- Toutes les tables enfants dénormalisent `school_id` pour que les policies
  RLS n'aient jamais besoin de remonter plusieurs jointures pour vérifier
  l'isolation (perf + simplicité + robustesse).

---

## Étape 4 — Stratégie RLS et règles d'accès par rôle

### 4.1 Principe général

Le JWT Supabase ne contient que `sub` (user id). **Aucun claim `school_id`
ou `role` n'est mis dans le JWT** (un JWT vit potentiellement des heures ;
un rôle révoqué doit être coupé immédiatement). À la place, des fonctions
`SECURITY DEFINER` interrogent les tables serveur à chaque requête :

```sql
create schema if not exists app;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function app.school_role(p_school_id uuid) returns text
language sql stable security definer as $$
  select role from school_users
  where school_id = p_school_id and user_id = auth.uid() and status = 'active'
  limit 1;
$$;

create or replace function app.is_school_member(p_school_id uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from school_users
    where school_id = p_school_id and user_id = auth.uid() and status = 'active'
  );
$$;

-- élèves auxquels l'utilisateur courant a droit en tant que responsable
create or replace function app.guardian_student_ids(p_financial_only boolean default false)
returns setof uuid
language sql stable security definer as $$
  select sg.student_id
  from student_guardians sg
  join guardians g on g.id = sg.guardian_id
  where g.user_id = auth.uid()
    and sg.can_receive_notifications
    and (not p_financial_only or sg.can_receive_financial_documents);
$$;
```

`security definer` + `search_path` fixé sur ces fonctions (pour éviter
tout hijacking), exécutées avec les droits du propriétaire mais restant
`stable` et ne lisant que sur des tables où les policies ne s'appliquent
pas en boucle (ou en les marquant `security definer` justement pour
contourner RLS sur ces tables précises, en gardant le contrôle strict dans
le corps SQL ci-dessus).

### 4.2 Policies type par table (exemples représentatifs)

```sql
alter table students enable row level security;

create policy students_select on students for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant','admin_staff')
  or id in (select app.guardian_student_ids())
);

create policy students_write on students for insert with check (
  app.school_role(school_id) in ('director','admin_staff')
);
create policy students_update on students for update using (
  app.school_role(school_id) in ('director','admin_staff')
) with check (
  app.school_role(school_id) in ('director','admin_staff')
);
-- pas de delete direct : archivage via status='withdrawn'
```

```sql
alter table invoices enable row level security;

create policy invoices_select on invoices for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant')
  or student_id in (select app.guardian_student_ids(true))
);
-- Aucune policy INSERT/UPDATE directe pour les clients : la création/
-- annulation de facture passe exclusivement par une Edge Function
-- (service_role), qui contourne RLS après avoir revalidé le rôle.
-- Donc PAS de policy for insert/update ici -> RLS bloque par défaut
-- tout accès direct en écriture depuis le client.
```

```sql
alter table payments enable row level security;

create policy payments_select on payments for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant')
  or student_id in (select app.guardian_student_ids(true))
);
-- INSERT (enregistrement) et UPDATE (confirmation/rejet) : uniquement
-- via Edge Functions 'record-payment' / 'confirm-payment' / 'reject-payment'.
-- Aucune policy write cliente.
```

```sql
alter table receipts enable row level security;

create policy receipts_select on receipts for select using (
  app.is_super_admin()
  or app.school_role(school_id) in ('director','accountant')
  or payment_id in (
    select p.id from payments p
    where p.student_id in (select app.guardian_student_ids(true))
  )
);
-- Le PDF lui-même n'est jamais servi via une URL publique : la lecture de
-- cette ligne autorise seulement l'appel à l'Edge Function qui émet une
-- URL signée à courte durée de vie après re-vérification.
```

```sql
alter table audit_logs enable row level security;

create policy audit_logs_select on audit_logs for select using (
  app.is_super_admin()
  or (school_id is not null and app.school_role(school_id) = 'director')
);
-- Aucune policy insert/update/delete pour les rôles applicatifs : seules
-- les Edge Functions (service_role) et les triggers SQL écrivent ici.
-- REVOKE explicite de delete/update sur audit_logs pour tous les rôles
-- non service_role, y compris 'director'.
```

### 4.3 Règles par rôle (résumé)

| Rôle | Élèves | Responsables | Factures | Paiements | Reçus | Impayés/Dashboard | Paramètres financiers | Audit log |
|---|---|---|---|---|---|---|---|---|
| Super admin | toutes écoles (accès audité) | idem | idem | idem | idem | idem | gestion plateforme | tout (lecture) |
| Directeur | lecture/écriture (son école) | lecture/écriture | lecture (création via EF) | lecture | lecture | lecture complète | lecture/écriture | lecture (son école) |
| Comptable | lecture | lecture | lecture | créer/confirmer/rejeter (EF) | générer/lecture | lecture créances | lecture seule | non |
| Admin staff | selon `permissions` jsonb | selon permissions | non par défaut | non | non | non | non | non |
| Parent | son(ses) enfant(s) seulement | son propre profil | son(ses) enfant(s), si `can_receive_financial_documents` | lecture de ses paiements confirmés | lecture si autorisé | non | non | non |

`admin_staff` : les policies générales le bloquent (`role in ('director','accountant')` uniquement) ; les accès fins passent par une vérification `permissions ->> 'xxx' = 'true'` ajoutée aux policies concernées, jamais par un flag côté client.

### 4.4 Ce que la RLS empêche mécaniquement

- Changer son propre `school_id` ou son `role` : **aucune** policy `update`
  n'existe sur `school_users` pour le rôle lui-même ; seule une Edge Function
  `director`-only (elle-même vérifiée serveur) peut modifier un rôle, avec
  audit log obligatoire.
- Lire une autre école en changeant un ID dans l'URL : la policy `select`
  revérifie `school_role(school_id)` à partir de `school_users`, indépendant
  de ce qu'envoie le frontend.
- Un parent qui devine l'UUID d'une facture d'un autre enfant : la policy
  `invoices_select` exige que `student_id` soit dans son
  `guardian_student_ids(true)`, recalculé serveur à chaque requête.

---

## Étape 5 — Workflows principaux

### 5.1 Création d'une facture
1. Comptable/Directeur choisit élève + année scolaire + `fee_schedule`(s)
   applicables (ou le système les pré-remplit depuis `student_fee_assignments`).
2. Edge Function `create-invoice` (service_role) :
   - revérifie que l'appelant est `director`/`accountant` de l'école ;
   - recharge `student_fee_assignments` (montant, réduction, exonération)
     **depuis la DB**, ignore tout montant envoyé par le client ;
   - crée `invoices` (status `issued`) + `invoice_items` dans une transaction ;
   - numérote via une séquence par école (`school_id + invoice_number`).
3. Facture visible immédiatement au parent concerné (RLS).

### 5.2 Paiement (enregistrement)
1. Comptable saisit montant, moyen, référence, date → appel Edge Function
   `record-payment` avec un `idempotency_key` généré côté client (UUID v4
   stocké localement le temps de la saisie, pour survivre à un double clic
   ou une re-soumission réseau).
2. La fonction vérifie le rôle, que la facture appartient à l'école, que
   `amount > 0`, crée `payments` (status `pending`) + `payment_allocations`
   (répartition sur une ou plusieurs factures, jamais > solde restant),
   dans une transaction. `unique(school_id, idempotency_key)` empêche tout
   doublon même en cas de retry réseau exact.

### 5.3 Confirmation d'un paiement
1. Comptable/Directeur clique "Confirmer" → Edge Function `confirm-payment`.
2. Vérifie : paiement existe, `status = 'pending'` (sinon no-op idempotent :
   si déjà `confirmed`, renvoie succès sans rejouer les effets de bord),
   appelant autorisé.
3. Transaction : `status → confirmed`, `confirmed_by/at` ; le trigger
   `trg_invoices_paid_amount` recalcule `invoices.paid_amount`/`status` ;
   génère le PDF du reçu côté serveur, l'enregistre dans le bucket privé
   `receipts`, insère la ligne `receipts` (contrainte `unique(payment_id)`
   empêche toute double génération même en cas de rejeu) ; insère une ligne
   `audit_logs`.
4. Enqueue les notifications (voir 5.4/5.6) vers les responsables autorisés
   (`can_receive_financial_documents = true`).

### 5.4 Génération et envoi du reçu
- Le reçu n'est **jamais** créé sur simple déclaration du parent : seul
  `confirm-payment` peut créer une ligne `receipts`.
- PDF généré côté serveur (Deno + lib PDF, données lues depuis la DB au
  moment de la génération, jamais depuis le payload client).
- Après création : Edge Function `send-notification-worker` (déclenchée par
  insertion dans `notifications`) envoie via email/WhatsApp selon les
  canaux activés pour l'école et le consentement du responsable.

### 5.5 Paiement partiel
- `payment_allocations.amount` peut être inférieur au solde de la facture ;
  `invoices.status` passe à `partially_paid` automatiquement (trigger) tant
  que `paid_amount < total_amount`.
- Les rappels futurs (5.6) se basent toujours sur `total_amount - paid_amount`
  recalculé au moment de l'envoi, jamais sur un montant figé.

### 5.6 Rappel automatique (reminders)
1. Cron `process-reminders` (toutes les heures ou 1x/jour selon config) :
   pour chaque `reminder_rule` active, calcule les factures dont
   `due_date + offset_days = aujourd'hui` et `status in ('issued','partially_paid','overdue')`.
2. Pour chaque facture concernée : calcule `solde = total_amount - paid_amount`.
   Si `solde <= 0` → aucune notification, et toute notification `scheduled`
   déjà en file pour cette facture est marquée `cancelled`.
3. Sinon, insère dans `notifications` avec
   `idempotency_key = hash(invoice_id, reminder_rule_id, due_date_bucket)` :
   la contrainte unique empêche un doublon si le cron tourne deux fois.
4. `send-notification-worker` dépile les `queued`, appelle le provider,
   met à jour `status` (`sent`/`failed`) et `provider_message_id`.

### 5.7 Retard (overdue)
- Job quotidien : factures `due_date < today` et solde > 0 → `status = 'overdue'`.
- Alimente directement la liste des impayés et le dashboard (Étape 14/15).

### 5.8 Remboursement
- Demande (`refunds.status = pending`) créée par comptable/directeur.
- Approbation par directeur (ou règle définie) → Edge Function
  `approve-refund` : transaction créant une écriture de régularisation
  (jamais de suppression du paiement d'origine), ajuste `invoices.paid_amount`
  via une nouvelle ligne d'allocation négative tracée, audit log complet.

### 5.9 Changement d'année scolaire
- Directeur crée `school_years` (nouvelle ligne), configure `fee_schedules`
  pour la nouvelle année. Les anciennes factures/paiements/reçus restent
  intacts et consultables (aucune donnée n'est écrasée : tout est lié à
  `school_year_id`). Le "rollover" copie éventuellement les élèves actifs
  vers de nouvelles `student_enrollments` et propose de dupliquer les
  `fee_schedules` comme trame de départ (action explicite, jamais automatique
  et silencieuse).

---

## Étape 6 — Edge Functions nécessaires

Toutes en Deno, `service_role`, authentification obligatoire par vérification
du JWT utilisateur transmis (`Authorization: Bearer <jwt>`), revalidation du
rôle depuis la DB à chaque appel (jamais de confiance dans un claim client).

| Fonction | Rôle appelant | Rôle |
|---|---|---|
| `create-school` | super admin | Provisionne une école + premier directeur |
| `invite-school-user` | directeur | Invite comptable/staff/lui-même sur une autre école |
| `accept-invite` | invité (auth) | Active `school_users.status` |
| `change-user-role` | directeur | Modifie un rôle, audit log obligatoire |
| `create-invoice` | directeur/comptable | Génère facture depuis `student_fee_assignments`, calcule tout serveur |
| `cancel-invoice` | directeur | Annulation tracée (jamais suppression) |
| `record-payment` | comptable/directeur | Enregistre paiement `pending`, idempotent |
| `confirm-payment` | comptable/directeur | Confirme, déclenche reçu + notifications, idempotent |
| `reject-payment` | comptable/directeur | Rejette avec motif |
| `request-refund` / `approve-refund` | comptable / directeur | Workflow remboursement |
| `approve-discount` | directeur | Validation réduction/exonération importante |
| `generate-document-url` | tout rôle autorisé | Revalide l'accès puis émet URL signée courte durée (facture/reçu) |
| `process-reminders` | cron (scheduled function) | Calcule et enqueue les rappels, idempotent |
| `send-notification-worker` | cron / trigger interne | Dépile `notifications`, appelle email/WhatsApp |
| `whatsapp-webhook` | WhatsApp platform | Vérifie signature, met à jour statut delivered/failed |
| `email-webhook` | fournisseur email | Idem (bounce/delivered) |
| `close-school-year` | directeur | Marque une année `closed`, active la nouvelle |
| `export-audit-log` | directeur/super admin | Export CSV/PDF pour conformité |
| *(future)* `payment-provider-webhook` | prestataire de paiement | Stub documenté §21, non implémenté au MVP |

Chaque fonction : valide entrée avec un schéma strict (zod), rejette tout
champ non attendu, ne fait jamais confiance à un `amount`/`school_id`/`role`
envoyé par le client sans le recroiser avec la DB, retourne des erreurs
génériques au client (jamais de stack trace ni détail interne), journalise
en interne (logs serveur) le détail réel.

---

## Étape 7 — Organisation du frontend

```
src/
  app/                  # routing, layout racine, providers (auth, query)
  pages/                # une page = une route (mobile-first)
    dashboard/
    students/
    guardians/
    fees/
    invoices/
    payments/
    receipts/
    reminders/
    parents-portal/
    reports/
    settings/
  features/             # logique métier par domaine (feature-sliced)
    students/{api,hooks,components,types}
    invoices/{api,hooks,components,types}
    payments/{api,hooks,components,types}
    receipts/...
    reminders/...
    dashboard/...
    auth/...
  components/           # UI partagée (design system léger)
  services/
    supabase/           # client supabase-js, wrappers typés par table
    edge-functions/     # wrappers fetch typés par Edge Function
  hooks/                # hooks transverses (useSchoolContext, useRole...)
  lib/                  # formatters (devise, dates), validation zod partagée
  types/                # types générés depuis le schéma Supabase + DTO métier
  styles/
public/
  manifest.webmanifest
  icons/
```

- **Aucune logique d'autorisation "définitive"** dans `features/*` : les
  hooks affichent/masquent pour l'UX, mais chaque écran suppose que le
  serveur peut refuser.
- `useSchoolContext` : école courante sélectionnée par l'utilisateur parmi
  ses `school_users` actifs (pas un claim JWT) — chaque requête envoyée
  inclut `school_id` **à titre indicatif pour l'UI**, mais RLS revalide.
- PWA : `vite-plugin-pwa`, service worker cache-first pour les assets,
  network-first pour les données financières (jamais de cache offline des
  montants sensibles au-delà d'une session courte).
- Génération PDF : jamais côté client pour les documents officiels
  (facture/reçu) — uniquement affichage d'un PDF généré serveur, récupéré
  via URL signée temporaire.

---

## Étape 8 — Sécurité et tests à effectuer

### 8.1 Mesures

- RLS activé sur **toutes** les tables métier, avec `FORCE ROW LEVEL SECURITY`
  pour que même le propriétaire de la table (hors `service_role`) soit
  soumis aux policies.
- Aucune policy `insert`/`update` cliente sur `invoices`, `payments`,
  `receipts`, `refunds`, `audit_logs`, `school_users` (rôle) : ces tables ne
  sont modifiées que via Edge Functions `service_role`.
- `search_path` fixé sur toutes les fonctions `SECURITY DEFINER`.
- Buckets Storage privés (`invoices`, `receipts`) : policy Storage exigeant
  un chemin `((storage.foldername(name))[1])::uuid = school_id` **et**
  revalidation supplémentaire via Edge Function pour émettre l'URL signée
  (défense en profondeur, pas uniquement policy Storage).
- Rate limiting sur les Edge Functions sensibles (login, record-payment,
  confirm-payment) pour limiter le brute force / abus.
- Validation stricte (zod) de toute entrée d'Edge Function ; rejet des
  champs additionnels.
- Contraintes `unique` + `idempotency_key` pour paiements, reçus,
  notifications (anti double-traitement/replay).
- Aucune clé `service_role` ni secret fournisseur dans le code frontend ou
  le dépôt Git (`.env` uniquement pour URL/anon key publics ; secrets réels
  via `supabase secrets set` / variables d'environnement Netlify serveur
  uniquement si nécessaire côté build, jamais exposées au bundle).
- Erreurs renvoyées au client : messages génériques, détail complet loggé
  serveur uniquement.
- CSP stricte sur Netlify (`_headers`), en-têtes sécurité (HSTS,
  X-Frame-Options, X-Content-Type-Options).

### 8.2 Tests obligatoires avant toute mise en production (cf. §27 du cahier des charges)

Chaque test ci-dessous sera automatisé (pgTAP pour la DB/RLS, tests
d'intégration sur les Edge Functions, tests E2E légers sur les parcours
critiques) :

1. **Isolation inter-écoles** : utilisateur école A → toute lecture/écriture
   sur une ressource école B doit renvoyer 0 ligne / erreur d'autorisation.
2. **Élévation de privilège** : comptable appelant `change-user-role` ou
   modifiant `fee_schedules` réservé au directeur → refusé.
3. **Accès parent croisé** : parent A → facture/reçu de l'enfant B → refusé.
4. **Manipulation d'URL/ID** : remplacer un UUID de facture/reçu/paiement
   dans une requête → aucune fuite, RLS bloque.
5. **Double confirmation de paiement** : appeler `confirm-payment` deux fois
   sur le même paiement → un seul effet (reçu unique, montant inchangé).
6. **Double rappel** : rejouer `process-reminders` sur le même jour → aucune
   notification en double (`idempotency_key`).
7. **Montant falsifié** : envoyer un `amount` différent du calcul serveur à
   `create-invoice`/`record-payment` → serveur recalcule/rejette.
8. **`school_id` falsifié** : tenter de le modifier depuis le client (payload
   Edge Function ou update direct) → rejeté par RLS/validation serveur.
9. **`role` falsifié** : idem → rejeté, seule `change-user-role` (directeur,
   auditée) peut modifier un rôle.
10. **Document altéré** : modifier l'identifiant d'un reçu dans l'URL de
    téléchargement → accès refusé après revalidation serveur.

---

## Points à clarifier avant de coder (risques à signaler)

1. **Fournisseur email transactionnel** : aucun n'est encore choisi. Je
   recommande un fournisseur avec API + webhooks de statut (bounce/delivered)
   et bon support depuis l'Afrique de l'Ouest. À valider avant d'écrire
   `send-notification-worker`.
2. **WhatsApp Business Platform** : nécessite un compte Meta Business vérifié
   et des templates pré-approuvés ; tant que la configuration n'est pas
   disponible (comme précisé dans la demande), le canal restera codé mais
   désactivé (`notification_channel_settings.enabled = false`), sans appel
   réseau réel.
3. **Génération de PDF côté serveur** : à trancher entre une librairie Deno
   native (ex. rendu HTML→PDF via un moteur headless packagé, ou une lib PDF
   pure) exécutée dans l'Edge Function — impact sur le temps d'exécution et
   la taille du bundle de la fonction. Je proposerai une option précise à
   l'implémentation.
4. **Cron/scheduling** : `pg_cron` (si activé sur le projet Supabase) vs.
   Supabase Scheduled Edge Functions — à confirmer selon le plan Supabase
   utilisé.

---

*Ce document sera complété/affiné au fil de l'implémentation ; toute
divergence entre le code et ce document doit être corrigée dans les deux
sens.*
