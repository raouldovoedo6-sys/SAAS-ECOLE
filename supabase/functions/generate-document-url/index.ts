import { z } from "npm:zod@3";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  documentType: z.enum(["invoice", "receipt"]),
  documentId: z.string().uuid(),
});

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes : jamais d'URL publique permanente

// Revalide entièrement l'autorisation côté serveur : staff de l'école, ou
// responsable explicitement autorisé pour CET élève (student_guardians
// .can_receive_financial_documents = true). Ne fait jamais confiance à
// l'ID reçu sans recroiser les tables (anti-IDOR : voir docs §13/§27).
async function isStaffOfSchool(admin: SupabaseClient, userId: string, schoolId: string): Promise<boolean> {
  const { data } = await admin
    .from("school_users")
    .select("role")
    .eq("user_id", userId)
    .eq("school_id", schoolId)
    .eq("status", "active")
    .in("role", ["director", "accountant"])
    .maybeSingle();
  return !!data;
}

async function isAuthorizedGuardianForStudent(
  admin: SupabaseClient,
  userId: string,
  studentId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("student_guardians")
    .select("id, guardians!inner(user_id)")
    .eq("student_id", studentId)
    .eq("can_receive_financial_documents", true)
    .eq("guardians.user_id", userId)
    .maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    let storagePath: string;
    let studentId: string;
    let bucket: string;

    if (body.documentType === "receipt") {
      const { data: receipt, error } = await admin
        .from("receipts")
        .select("pdf_storage_path, payment:payments(student_id)")
        .eq("id", body.documentId)
        .eq("school_id", body.schoolId)
        .maybeSingle();

      if (error || !receipt) throw new AppError(404, "Document introuvable.");
      const payment = Array.isArray(receipt.payment) ? receipt.payment[0] : receipt.payment;
      if (!payment) throw new AppError(404, "Document introuvable.");

      storagePath = receipt.pdf_storage_path;
      studentId = payment.student_id;
      bucket = "receipts";
    } else {
      const { data: invoice, error } = await admin
        .from("invoices")
        .select("student_id, invoice_number")
        .eq("id", body.documentId)
        .eq("school_id", body.schoolId)
        .maybeSingle();

      if (error || !invoice) throw new AppError(404, "Document introuvable.");
      // Les factures ne sont pas (encore) stockées en PDF pré-généré dans le
      // MVP ; le chemin suit la même convention que les reçus pour permettre
      // un ajout ultérieur sans changer le contrat de cette fonction.
      storagePath = `${body.schoolId}/${body.documentId}.pdf`;
      studentId = invoice.student_id;
      bucket = "invoices";
    }

    const authorized =
      (await isStaffOfSchool(admin, user.id, body.schoolId)) ||
      (await isAuthorizedGuardianForStudent(admin, user.id, studentId));

    if (!authorized) {
      throw new AppError(403, "Accès à ce document non autorisé.");
    }

    const { data: signed, error: signError } = await admin.storage
      .from(bucket)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed) {
      throw new AppError(404, "Document introuvable ou non encore généré.", signError);
    }

    await admin.from("document_access_logs").insert({
      school_id: body.schoolId,
      user_id: user.id,
      document_type: body.documentType,
      document_id: body.documentId,
      action: "signed_url_issued",
    });

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "document.signed_url_issued",
      entityType: body.documentType,
      entityId: body.documentId,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(
      JSON.stringify({ url: signed.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
