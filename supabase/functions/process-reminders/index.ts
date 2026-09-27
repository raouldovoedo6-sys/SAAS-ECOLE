import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";

// Invoquée par un déclencheur planifié (pg_cron / Supabase Scheduled
// Functions), jamais par le frontend : authentification par secret partagé
// plutôt que par JWT utilisateur (il n'y a pas d'utilisateur humain ici).
function requireCronSecret(req: Request) {
  const expected = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || !provided || provided !== expected) {
    throw new AppError(401, "Non autorisé.");
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Le parent n'utilise jamais l'application : ce lien est son seul accès au
// document, envoyé directement dans le rappel SMS/WhatsApp.
const PARENT_DOCUMENT_LINK_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 jours

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    requireCronSecret(req);

    // 1. Marque les factures en retard (recalcul quotidien indépendant des
    // événements de paiement).
    const { error: overdueError } = await admin.rpc("fn_mark_overdue_invoices");
    if (overdueError) throw new AppError(500, "Erreur mise à jour des factures en retard.", overdueError);

    const today = todayIso();
    let scheduled = 0;
    let cancelledFullyPaid = 0;

    // 2. Annule les rappels programmés pour des factures désormais soldées
    // (jamais de rappel sur un montant déjà payé).
    const { data: paidInvoices } = await admin
      .from("invoices")
      .select("id")
      .eq("status", "paid");
    const paidIds = (paidInvoices ?? []).map((i) => i.id);
    if (paidIds.length > 0) {
      const { data: cancelled } = await admin
        .from("notifications")
        .update({ status: "cancelled" })
        .in("invoice_id", paidIds)
        .eq("status", "scheduled")
        .select("id");
      cancelledFullyPaid = cancelled?.length ?? 0;
    }

    // 3. Règles de rappel actives, par école
    const { data: rules, error: rulesError } = await admin
      .from("reminder_rules")
      .select("id, school_id, offset_days, channel, template_name")
      .eq("active", true);
    if (rulesError) throw new AppError(500, "Erreur de lecture des règles de rappel.", rulesError);

    for (const rule of rules ?? []) {
      // due_date + offset_days = today  =>  due_date = today - offset_days
      const targetDueDate = addDays(today, -rule.offset_days);

      const { data: invoices, error: invError } = await admin
        .from("invoices")
        .select("id, invoice_number, student_id, total_amount, paid_amount, due_date")
        .eq("school_id", rule.school_id)
        .eq("due_date", targetDueDate)
        .in("status", ["issued", "partially_paid", "overdue"]);
      if (invError) {
        console.error("[process-reminders] lecture factures échouée", rule.id, invError);
        continue;
      }

      for (const invoice of invoices ?? []) {
        const balance = invoice.total_amount - invoice.paid_amount;
        // Solde déjà nul : ne jamais envoyer de rappel (voir §11 du cahier
        // des charges), même si la facture n'est pas encore marquée 'paid'.
        if (balance <= 0) continue;

        const { data: student } = await admin
          .from("students")
          .select("first_name, last_name, student_code")
          .eq("id", invoice.student_id)
          .single();

        // Lien vers la facture déjà générée à sa création (create-invoice) ;
        // si l'objet n'existe pas encore pour une raison quelconque,
        // createSignedUrl échoue simplement et documentUrl reste null (le
        // message est alors envoyé sans lien plutôt que de bloquer le rappel).
        const invoiceStoragePath = `${rule.school_id}/${invoice.id}.pdf`;
        const { data: signedInvoice } = await admin.storage
          .from("invoices")
          .createSignedUrl(invoiceStoragePath, PARENT_DOCUMENT_LINK_TTL_SECONDS);
        const documentUrl = signedInvoice?.signedUrl ?? null;

        const { data: guardianLinks } = await admin
          .from("student_guardians")
          .select("guardian_id, guardians(id, phone, consent_whatsapp, consent_sms)")
          .eq("student_id", invoice.student_id)
          .eq("can_receive_notifications", true);

        const { data: channelSettings } = await admin
          .from("notification_channel_settings")
          .select("channel, enabled")
          .eq("school_id", rule.school_id);
        const enabledChannels = new Set((channelSettings ?? []).filter((c) => c.enabled).map((c) => c.channel));

        const ruleChannels: Array<"whatsapp" | "sms"> =
          rule.channel === "both" ? ["whatsapp", "sms"] : [rule.channel as "whatsapp" | "sms"];

        for (const link of guardianLinks ?? []) {
          const guardian = Array.isArray(link.guardians) ? link.guardians[0] : link.guardians;
          if (!guardian?.phone) continue;

          for (const channel of ruleChannels) {
            if (!enabledChannels.has(channel)) continue;
            if (channel === "whatsapp" && !guardian.consent_whatsapp) continue;
            if (channel === "sms" && !guardian.consent_sms) continue;

            const { error: insertError } = await admin.from("notifications").insert({
              school_id: rule.school_id,
              student_id: invoice.student_id,
              guardian_id: guardian.id,
              invoice_id: invoice.id,
              reminder_rule_id: rule.id,
              channel,
              type: "reminder",
              template_name: rule.template_name,
              payload: {
                student_full_name: `${student?.first_name ?? ""} ${student?.last_name ?? ""}`.trim(),
                student_code: student?.student_code ?? "",
                invoice_number: invoice.invoice_number,
                balance,
                due_date: invoice.due_date,
                document_url: documentUrl,
              },
              status: "scheduled",
              // Bucketé par jour : un même événement (facture + règle +
              // responsable + canal + date du jour) ne génère jamais deux
              // notifications, même si le cron est rejoué plusieurs fois.
              idempotency_key: `reminder:${invoice.id}:${rule.id}:${guardian.id}:${channel}:${today}`,
            });
            if (!insertError) {
              scheduled += 1;
            } else if (insertError.code !== "23505") {
              console.error("[process-reminders] insertion notification échouée", insertError);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ scheduled, cancelledFullyPaid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
