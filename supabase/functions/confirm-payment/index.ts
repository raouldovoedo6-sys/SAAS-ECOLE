import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";
import { generateReceiptPdf } from "../_shared/pdf.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  paymentId: z.string().uuid(),
});

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Espèces",
  mobile_money: "Mobile Money",
  bank_transfer: "Virement bancaire",
  cheque: "Chèque",
  other: "Autre",
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    await requireSchoolRole(admin, user.id, body.schoolId, ["director", "accountant"]);

    // Transition de statut atomique côté SQL (idempotente : rejouer sur un
    // paiement déjà confirmé ne produit aucun nouvel effet de bord).
    const { data: confirmData, error: confirmError } = await admin.rpc("fn_confirm_payment", {
      p_payment_id: body.paymentId,
      p_school_id: body.schoolId,
      p_actor_user_id: user.id,
    });

    if (confirmError) {
      throw new AppError(400, confirmError.message);
    }

    const confirmResult = Array.isArray(confirmData) ? confirmData[0] : confirmData;

    if (confirmResult?.already_confirmed) {
      const { data: existingReceipt } = await admin
        .from("receipts")
        .select("id, receipt_number, pdf_storage_path")
        .eq("payment_id", body.paymentId)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          payment: { id: body.paymentId, status: "confirmed", alreadyConfirmed: true },
          receipt: existingReceipt ?? null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "payment.confirm",
      entityType: "payments",
      entityId: body.paymentId,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    // ---- Rassemble les données nécessaires au reçu, depuis la base ----
    const { data: payment, error: paymentErr } = await admin
      .from("payments")
      .select("id, student_id, amount, currency, payment_method, reference, payment_date")
      .eq("id", body.paymentId)
      .single();
    if (paymentErr || !payment) {
      throw new AppError(500, "Impossible de récupérer le paiement confirmé.", paymentErr);
    }

    const { data: student } = await admin
      .from("students")
      .select("first_name, last_name, student_code")
      .eq("id", payment.student_id)
      .single();

    const { data: school } = await admin
      .from("schools")
      .select("name")
      .eq("id", body.schoolId)
      .single();

    const { data: allocations } = await admin
      .from("payment_allocations")
      .select("amount, invoice:invoices(id, total_amount, paid_amount)")
      .eq("payment_id", body.paymentId);

    const invoiceMap = new Map<string, { total_amount: number; paid_amount: number }>();
    for (const alloc of allocations ?? []) {
      const inv = Array.isArray(alloc.invoice) ? alloc.invoice[0] : alloc.invoice;
      if (inv) invoiceMap.set(inv.id, { total_amount: inv.total_amount, paid_amount: inv.paid_amount });
    }
    let totalDue = 0;
    let paidToDate = 0;
    for (const inv of invoiceMap.values()) {
      totalDue += inv.total_amount;
      paidToDate += inv.paid_amount;
    }

    const receiptNumberRes = await admin.rpc("fn_next_document_number", {
      p_school_id: body.schoolId,
      p_doc_type: "receipt",
      p_prefix: "REC",
    });
    if (receiptNumberRes.error) {
      throw new AppError(500, "Erreur de numérotation du reçu.", receiptNumberRes.error);
    }
    const receiptNumber = receiptNumberRes.data as string;

    const pdfBytes = await generateReceiptPdf({
      schoolName: school?.name ?? "École",
      receiptNumber,
      issuedAtLabel: new Date().toLocaleDateString("fr-FR"),
      studentFullName: `${student?.first_name ?? ""} ${student?.last_name ?? ""}`.trim(),
      studentCode: student?.student_code ?? "",
      amount: payment.amount,
      currency: payment.currency,
      paymentMethodLabel: PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method,
      reference: payment.reference,
      totalDue,
      paidToDate,
      balanceAfter: totalDue - paidToDate,
    });

    const storagePath = `${body.schoolId}/${body.paymentId}.pdf`;
    const { error: uploadError } = await admin.storage
      .from("receipts")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) {
      throw new AppError(500, "Erreur de stockage du reçu.", uploadError);
    }

    const { data: receiptData, error: receiptError } = await admin.rpc("fn_insert_receipt", {
      p_school_id: body.schoolId,
      p_payment_id: body.paymentId,
      p_receipt_number: receiptNumber,
      p_pdf_storage_path: storagePath,
      p_issued_by: user.id,
    });
    if (receiptError) {
      throw new AppError(500, "Erreur d'enregistrement du reçu.", receiptError);
    }
    const receiptResult = Array.isArray(receiptData) ? receiptData[0] : receiptData;

    // ---- Notifications aux responsables autorisés ----
    const { data: guardianLinks } = await admin
      .from("student_guardians")
      .select("guardian_id, guardians(id, phone, preferred_channel, consent_whatsapp, consent_sms)")
      .eq("student_id", payment.student_id)
      .eq("can_receive_financial_documents", true);

    const { data: channelSettings } = await admin
      .from("notification_channel_settings")
      .select("channel, enabled")
      .eq("school_id", body.schoolId);
    const enabledChannels = new Set((channelSettings ?? []).filter((c) => c.enabled).map((c) => c.channel));

    for (const link of guardianLinks ?? []) {
      const guardian = Array.isArray(link.guardians) ? link.guardians[0] : link.guardians;
      if (!guardian?.phone) continue;

      const candidateChannels: Array<"whatsapp" | "sms"> = [];
      if (enabledChannels.has("whatsapp") && guardian.consent_whatsapp) candidateChannels.push("whatsapp");
      if (enabledChannels.has("sms") && guardian.consent_sms) candidateChannels.push("sms");

      for (const channel of candidateChannels) {
        const { error: notifError } = await admin.from("notifications").insert({
          school_id: body.schoolId,
          student_id: payment.student_id,
          guardian_id: guardian.id,
          payment_id: body.paymentId,
          channel,
          type: "receipt",
          template_name: "receipt_confirmation",
          payload: {
            receipt_number: receiptNumber,
            amount: payment.amount,
            currency: payment.currency,
            student_full_name: `${student?.first_name ?? ""} ${student?.last_name ?? ""}`.trim(),
            school_name: school?.name ?? "",
            balance_after: totalDue - paidToDate,
          },
          status: "scheduled",
          idempotency_key: `receipt:${body.paymentId}:${guardian.id}:${channel}`,
        });
        // Conflit sur (school_id, idempotency_key) = notification déjà en
        // file pour ce reçu/canal/responsable : anti-doublon attendu, on
        // n'échoue jamais la confirmation (déjà actée) pour une erreur de
        // notification ; seule une erreur inattendue est journalisée.
        if (notifError && notifError.code !== "23505") {
          console.error("[notifications insert failed]", notifError);
        }
      }
    }

    return new Response(
      JSON.stringify({
        payment: { id: body.paymentId, status: "confirmed", alreadyConfirmed: false },
        receipt: {
          id: receiptResult?.out_receipt_id,
          receiptNumber,
          alreadyExisted: receiptResult?.already_existed ?? false,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
