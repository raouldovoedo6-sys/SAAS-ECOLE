import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";
import { generateInvoicePdf } from "../_shared/pdf.ts";
import { enqueueDocumentNotifications } from "../_shared/notifyGuardians.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
  schoolYearId: z.string().uuid(),
  guardianId: z.string().uuid().nullable().optional(),
  feeInstallmentIds: z.array(z.string().uuid()).min(1),
});

// Le parent n'utilise jamais l'application : ce lien, envoyé par
// SMS/WhatsApp, est son seul moyen d'accéder au document. Durée plus
// longue qu'un accès applicatif, mais toujours temporaire.
const PARENT_DOCUMENT_LINK_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 jours

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    // Revalide le rôle réel depuis school_users : jamais confiance dans un
    // rôle envoyé par le client.
    await requireSchoolRole(admin, user.id, body.schoolId, ["director", "accountant"]);

    // Toute la logique (validation des IDs, calcul des montants depuis les
    // tarifs/réductions en base, numérotation atomique, écriture facture +
    // lignes) est exécutée dans une seule transaction côté PostgreSQL.
    const { data, error } = await admin.rpc("fn_create_invoice", {
      p_school_id: body.schoolId,
      p_student_id: body.studentId,
      p_school_year_id: body.schoolYearId,
      p_guardian_id: body.guardianId ?? null,
      p_fee_installment_ids: body.feeInstallmentIds,
      p_actor_user_id: user.id,
    });

    if (error) {
      // Les messages levés par la fonction SQL (raise exception) sont déjà
      // rédigés pour être présentables à l'utilisateur (pas de détail
      // interne), donc on peut les relayer tels quels avec un code 400.
      throw new AppError(400, error.message);
    }

    const result = Array.isArray(data) ? data[0] : data;
    const invoiceId: string | undefined = result?.invoice_id;

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "invoice.create",
      entityType: "invoices",
      entityId: invoiceId ?? null,
      newValue: { total_amount: result?.total_amount, fee_installment_ids: body.feeInstallmentIds },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    // ---- Génère le PDF et notifie les responsables autorisés ----
    // Best-effort : si la génération/notification échoue, la facture reste
    // valide (déjà créée et auditée) ; l'erreur est journalisée sans faire
    // échouer la réponse au comptable/directeur qui vient de la créer.
    if (invoiceId) {
      try {
        const [{ data: invoiceRow }, { data: school }, { data: items }] = await Promise.all([
          admin
            .from("invoices")
            .select("invoice_number, issue_date, due_date, status, total_amount, paid_amount, currency, student_id, guardian_id")
            .eq("id", invoiceId)
            .single(),
          admin.from("schools").select("name").eq("id", body.schoolId).single(),
          admin.from("invoice_items").select("description, amount").eq("invoice_id", invoiceId),
        ]);

        if (invoiceRow) {
          const { data: student } = await admin
            .from("students")
            .select("first_name, last_name, student_code")
            .eq("id", invoiceRow.student_id)
            .single();

          let guardianName: string | null = null;
          if (invoiceRow.guardian_id) {
            const { data: guardian } = await admin
              .from("guardians")
              .select("first_name, last_name")
              .eq("id", invoiceRow.guardian_id)
              .maybeSingle();
            if (guardian) guardianName = `${guardian.first_name} ${guardian.last_name}`;
          }

          const pdfBytes = await generateInvoicePdf({
            schoolName: school?.name ?? "École",
            invoiceNumber: invoiceRow.invoice_number,
            issueDateLabel: new Date(invoiceRow.issue_date).toLocaleDateString("fr-FR"),
            dueDateLabel: new Date(invoiceRow.due_date).toLocaleDateString("fr-FR"),
            studentFullName: `${student?.first_name ?? ""} ${student?.last_name ?? ""}`.trim(),
            studentCode: student?.student_code ?? "",
            guardianName,
            items: (items ?? []).map((i) => ({ description: i.description, amount: i.amount })),
            totalAmount: invoiceRow.total_amount,
            paidAmount: invoiceRow.paid_amount,
            currency: invoiceRow.currency,
            statusLabel: invoiceRow.status,
          });

          const storagePath = `${body.schoolId}/${invoiceId}.pdf`;
          await admin.storage
            .from("invoices")
            .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

          const { data: signed } = await admin.storage
            .from("invoices")
            .createSignedUrl(storagePath, PARENT_DOCUMENT_LINK_TTL_SECONDS);

          await enqueueDocumentNotifications(admin, {
            schoolId: body.schoolId,
            studentId: invoiceRow.student_id,
            type: "invoice",
            templateName: "invoice_issued",
            documentUrl: signed?.signedUrl ?? null,
            invoiceId,
            idempotencyPrefix: `invoice:${invoiceId}`,
            extraPayload: {
              invoice_number: invoiceRow.invoice_number,
              total_amount: invoiceRow.total_amount,
              due_date: invoiceRow.due_date,
              student_full_name: `${student?.first_name ?? ""} ${student?.last_name ?? ""}`.trim(),
              school_name: school?.name ?? "",
            },
          });
        }
      } catch (notifyErr) {
        console.error("[create-invoice] génération/notification PDF échouée", notifyErr);
      }
    }

    return new Response(JSON.stringify({ invoice: result }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
