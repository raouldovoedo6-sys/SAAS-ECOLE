-- ============================================================
-- Remboursements : jamais de suppression de paiement pour corriger une
-- erreur (voir docs/ARCHITECTURE.md §10). Un remboursement approuvé réduit
-- les allocations existantes du paiement concerné, ce qui déclenche
-- automatiquement le trigger de recalcul déjà en place sur
-- payment_allocations (app.trg_payment_allocations_recalc) : aucune
-- nouvelle logique de recalcul n'est introduite, on réutilise le chemin
-- déjà testé.
-- ============================================================

-- Une allocation peut désormais descendre à 0 (entièrement remboursée),
-- mais jamais négative.
alter table payment_allocations drop constraint payment_allocations_amount_check;
alter table payment_allocations add constraint payment_allocations_amount_check check (amount >= 0);

create or replace function public.fn_request_refund(
  p_school_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_reason text,
  p_requested_by uuid
) returns table(out_refund_id uuid, out_status text)
language plpgsql security definer set search_path = public, app as $$
declare
  v_payment record;
  v_already_refunded numeric(12,2);
  v_refund_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Le montant du remboursement doit être positif.';
  end if;

  select * into v_payment from payments where id = p_payment_id and school_id = p_school_id;
  if not found then
    raise exception 'Paiement introuvable pour cette école.';
  end if;
  if v_payment.status <> 'confirmed' then
    raise exception 'Seul un paiement confirmé peut faire l''objet d''un remboursement.';
  end if;

  select coalesce(sum(amount), 0) into v_already_refunded
  from refunds
  where payment_id = p_payment_id and status in ('pending', 'approved', 'completed');

  if v_already_refunded + p_amount > v_payment.amount then
    raise exception 'Le montant demandé dépasse le solde remboursable de ce paiement.';
  end if;

  insert into refunds (school_id, payment_id, amount, reason, status, requested_by)
  values (p_school_id, p_payment_id, p_amount, p_reason, 'pending', p_requested_by)
  returning id into v_refund_id;

  return query select v_refund_id, 'pending'::text;
end;
$$;

revoke all on function public.fn_request_refund(uuid,uuid,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.fn_request_refund(uuid,uuid,numeric,text,uuid) to service_role;

create or replace function public.fn_approve_refund(
  p_refund_id uuid,
  p_school_id uuid,
  p_actor_user_id uuid,
  p_decision text, -- 'approved' | 'rejected'
  p_decision_reason text
) returns table(out_refund_id uuid, out_status text, already_decided boolean)
language plpgsql security definer set search_path = public, app as $$
declare
  v_refund record;
  v_remaining numeric(12,2);
  v_alloc record;
  v_reduce numeric(12,2);
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Décision invalide.';
  end if;

  select * into v_refund from refunds where id = p_refund_id and school_id = p_school_id for update;
  if not found then
    raise exception 'Demande de remboursement introuvable pour cette école.';
  end if;

  if v_refund.status in ('approved', 'rejected', 'completed') then
    return query select v_refund.id, v_refund.status, true;
    return;
  end if;

  if p_decision = 'rejected' then
    update refunds
    set status = 'rejected', approved_by = p_actor_user_id, updated_at = now(),
        reason = coalesce(v_refund.reason, '') || case when p_decision_reason is not null
          then E'\n[Rejet] ' || p_decision_reason else '' end
    where id = p_refund_id;

    return query select p_refund_id, 'rejected'::text, false;
    return;
  end if;

  -- Approbation : réduit les allocations du paiement (les plus récentes
  -- d'abord) à hauteur du montant remboursé. Chaque UPDATE déclenche le
  -- trigger de recalcul de la facture concernée.
  v_remaining := v_refund.amount;

  for v_alloc in
    select id, amount from payment_allocations
    where payment_id = v_refund.payment_id
    order by created_at desc
    for update
  loop
    exit when v_remaining <= 0;
    v_reduce := least(v_remaining, v_alloc.amount);
    if v_reduce > 0 then
      update payment_allocations set amount = amount - v_reduce where id = v_alloc.id;
      v_remaining := v_remaining - v_reduce;
    end if;
  end loop;

  if v_remaining > 0 then
    raise exception 'Incohérence : allocations insuffisantes pour appliquer ce remboursement.';
  end if;

  update refunds
  set status = 'completed', approved_by = p_actor_user_id, updated_at = now()
  where id = p_refund_id;

  return query select p_refund_id, 'completed'::text, false;
end;
$$;

revoke all on function public.fn_approve_refund(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.fn_approve_refund(uuid,uuid,uuid,text,text) to service_role;
