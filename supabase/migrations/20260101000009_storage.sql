-- ============================================================
-- Buckets de stockage privés pour factures et reçus PDF.
--
-- Aucune policy storage.objects n'est ajoutée pour 'authenticated'/'anon' :
-- storage.objects a RLS activé par défaut sur les projets Supabase, donc en
-- l'absence de policy, tout accès direct depuis le client est refusé.
-- Le SEUL chemin de lecture est l'Edge Function `generate-document-url`
-- (clé service_role, qui contourne le storage RLS), qui revalide
-- l'autorisation via les tables (invoices/payments/receipts + RLS) avant
-- d'émettre une URL signée à courte durée de vie. Convention de chemin :
-- '{school_id}/{year}/{document_id}.pdf'.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('invoices', 'invoices', false, 5242880, array['application/pdf']),
  ('receipts', 'receipts', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;
