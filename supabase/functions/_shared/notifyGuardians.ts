import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Les parents n'utilisent jamais l'application : ils reçoivent uniquement
// des messages SMS/WhatsApp contenant un lien direct (URL signée) vers
// leur document. Cette fonction met en file une notification par
// responsable autorisé × canal activé+consenti, avec le lien déjà inclus
// dans le payload (aucune authentification applicative n'est nécessaire
// pour ouvrir ce lien : la sécurité vient de la signature Supabase Storage
// à durée de vie limitée, pas d'un compte utilisateur).
export async function enqueueDocumentNotifications(
  admin: SupabaseClient,
  opts: {
    schoolId: string;
    studentId: string;
    type: "invoice" | "receipt" | "reminder";
    templateName: string;
    documentUrl: string | null;
    invoiceId?: string;
    paymentId?: string;
    reminderRuleId?: string;
    idempotencyPrefix: string; // doit être unique par événement (ex: `invoice:${invoiceId}`)
    extraPayload?: Record<string, unknown>;
  },
): Promise<void> {
  const { data: guardianLinks } = await admin
    .from("student_guardians")
    .select("guardian_id, guardians(id, phone, consent_whatsapp, consent_sms)")
    .eq("student_id", opts.studentId)
    .eq("can_receive_financial_documents", true);

  const { data: channelSettings } = await admin
    .from("notification_channel_settings")
    .select("channel, enabled")
    .eq("school_id", opts.schoolId);
  const enabledChannels = new Set((channelSettings ?? []).filter((c) => c.enabled).map((c) => c.channel));

  for (const link of guardianLinks ?? []) {
    const guardian = Array.isArray(link.guardians) ? link.guardians[0] : link.guardians;
    if (!guardian?.phone) continue;

    const candidateChannels: Array<"whatsapp" | "sms"> = [];
    if (enabledChannels.has("whatsapp") && guardian.consent_whatsapp) candidateChannels.push("whatsapp");
    if (enabledChannels.has("sms") && guardian.consent_sms) candidateChannels.push("sms");

    for (const channel of candidateChannels) {
      const { error } = await admin.from("notifications").insert({
        school_id: opts.schoolId,
        student_id: opts.studentId,
        guardian_id: guardian.id,
        invoice_id: opts.invoiceId ?? null,
        payment_id: opts.paymentId ?? null,
        reminder_rule_id: opts.reminderRuleId ?? null,
        channel,
        type: opts.type,
        template_name: opts.templateName,
        payload: { document_url: opts.documentUrl, ...opts.extraPayload },
        status: "scheduled",
        idempotency_key: `${opts.idempotencyPrefix}:${guardian.id}:${channel}`,
      });
      if (error && error.code !== "23505") {
        console.error("[enqueueDocumentNotifications] insertion échouée", error);
      }
    }
  }
}
