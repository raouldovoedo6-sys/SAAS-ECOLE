-- ============================================================
-- Wrappers RPC (schéma public, exposé par PostgREST) pour les opérations
-- internes que les Edge Functions doivent appeler de façon atomique côté
-- SQL. Restreints à service_role : ces fonctions ne sont jamais appelées
-- directement par le frontend, seulement par nos Edge Functions.
-- ============================================================

create or replace function public.fn_next_document_number(p_school_id uuid, p_doc_type text, p_prefix text)
returns text
language sql security definer set search_path = public, app as $$
  select app.next_document_number(p_school_id, p_doc_type, p_prefix);
$$;
revoke all on function public.fn_next_document_number(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_next_document_number(uuid, text, text) to service_role;

create or replace function public.fn_recalc_invoice(p_invoice_id uuid)
returns void
language sql security definer set search_path = public, app as $$
  select app.recalc_invoice(p_invoice_id);
$$;
revoke all on function public.fn_recalc_invoice(uuid) from public, anon, authenticated;
grant execute on function public.fn_recalc_invoice(uuid) to service_role;

create or replace function public.fn_mark_overdue_invoices()
returns void
language sql security definer set search_path = public, app as $$
  select app.mark_overdue_invoices();
$$;
revoke all on function public.fn_mark_overdue_invoices() from public, anon, authenticated;
grant execute on function public.fn_mark_overdue_invoices() to service_role;
