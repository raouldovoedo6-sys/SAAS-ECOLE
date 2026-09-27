import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { sendSms } from "../_shared/channels/sms.ts";
import { sendWhatsAppTemplate } from "../_shared/channels/whatsapp.ts";

const BATCH_SIZE = 50;

function requireCronSecret(req: Request) {
  const expected = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (!expected || !provided || provided !== expected) {
    throw new AppError(401, "Non autorisé.");
  }
}

function buildSmsMessage(type: string, payload: Record<string, unknown>): string {
  if (type === "receipt") {
    return `Reçu ${payload.receipt_number} : paiement de ${payload.amount} ${payload.currency} confirmé pour ${payload.student_full_name}. Solde restant : ${payload.balance_after}.`;
  }
  if (type === "reminder") {
    return `Rappel : ${payload.student_full_name} (${payload.student_code}) a un solde de ${payload.balance} sur la facture ${payload.invoice_number}, échéance ${payload.due_date}.`;
  }
  return "Notification de l'établissement scolaire.";
}

function buildWhatsAppParams(type: string, payload: Record<string, unknown>): string[] {
  if (type === "receipt") {
    return [String(payload.student_full_name ?? ""), String(payload.amount ?? ""), String(payload.receipt_number ?? "")];
  }
  if (type === "reminder") {
    return [String(payload.student_full_name ?? ""), String(payload.balance ?? ""), String(payload.due_date ?? "")];
  }
  return [];
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    requireCronSecret(req);

    const { data: pending, error } = await admin
      .from("notifications")
      .select("id, school_id, guardian_id, channel, type, template_name, payload")
      .in("status", ["scheduled", "queued"])
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw new AppError(500, "Erreur de lecture de la file de notifications.", error);

    let sent = 0;
    let failed = 0;
    let cancelled = 0;

    for (const notif of pending ?? []) {
      // Re-vérifie l'activation du canal au moment de l'envoi (défense en
      // profondeur : la configuration a pu changer depuis la mise en file).
      const { data: channelSetting } = await admin
        .from("notification_channel_settings")
        .select("enabled")
        .eq("school_id", notif.school_id)
        .eq("channel", notif.channel)
        .maybeSingle();

      if (!channelSetting?.enabled) {
        await admin
          .from("notifications")
          .update({ status: "cancelled", failure_reason: "Canal désactivé au moment de l'envoi." })
          .eq("id", notif.id);
        cancelled += 1;
        continue;
      }

      const { data: guardian } = await admin
        .from("guardians")
        .select("phone")
        .eq("id", notif.guardian_id)
        .maybeSingle();

      if (!guardian?.phone) {
        await admin
          .from("notifications")
          .update({ status: "failed", failed_at: new Date().toISOString(), failure_reason: "Aucun numéro de téléphone." })
          .eq("id", notif.id);
        failed += 1;
        continue;
      }

      try {
        let providerMessageId: string | undefined;
        if (notif.channel === "sms") {
          const result = await sendSms({ to: guardian.phone, message: buildSmsMessage(notif.type, notif.payload) });
          providerMessageId = result.providerMessageId;
        } else {
          const result = await sendWhatsAppTemplate({
            to: guardian.phone,
            templateName: notif.template_name,
            bodyParameters: buildWhatsAppParams(notif.type, notif.payload),
          });
          providerMessageId = result.providerMessageId;
        }

        await admin
          .from("notifications")
          .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerMessageId ?? null })
          .eq("id", notif.id);
        sent += 1;
      } catch (sendErr) {
        console.error("[send-notification-worker] échec envoi", notif.id, sendErr);
        await admin
          .from("notifications")
          .update({
            status: "failed",
            failed_at: new Date().toISOString(),
            failure_reason: sendErr instanceof Error ? sendErr.message : "Erreur inconnue",
          })
          .eq("id", notif.id);
        failed += 1;
      }
    }

    return new Response(
      JSON.stringify({ processed: (pending ?? []).length, sent, failed, cancelled }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
