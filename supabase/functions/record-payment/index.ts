import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  schoolYearId: z.string().uuid(),
  studentId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().default("XOF"),
  paymentMethod: z.enum(["cash", "mobile_money", "bank_transfer", "cheque", "other"]),
  reference: z.string().max(200).nullable().optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (AAAA-MM-JJ)"),
  // Généré côté client (UUID) et conservé le temps de la saisie pour
  // survivre à un double clic ou une re-soumission réseau : voir
  // docs/ARCHITECTURE.md §5.2/§19.
  idempotencyKey: z.string().min(8).max(200),
  allocations: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        amount: z.number().positive(),
      }),
    )
    .min(1),
});

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    await requireSchoolRole(admin, user.id, body.schoolId, ["director", "accountant"]);

    const { data, error } = await admin.rpc("fn_record_payment", {
      p_school_id: body.schoolId,
      p_school_year_id: body.schoolYearId,
      p_student_id: body.studentId,
      p_amount: body.amount,
      p_currency: body.currency,
      p_payment_method: body.paymentMethod,
      p_reference: body.reference ?? null,
      p_payment_date: body.paymentDate,
      p_idempotency_key: body.idempotencyKey,
      p_recorded_by: user.id,
      p_allocations: body.allocations.map((a) => ({ invoice_id: a.invoiceId, amount: a.amount })),
    });

    if (error) {
      throw new AppError(400, error.message);
    }

    const result = Array.isArray(data) ? data[0] : data;

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "payment.record",
      entityType: "payments",
      entityId: result?.out_payment_id ?? null,
      newValue: { amount: body.amount, payment_method: body.paymentMethod, allocations: body.allocations },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(
      JSON.stringify({
        payment: {
          id: result?.out_payment_id,
          paymentNumber: result?.out_payment_number,
          status: result?.out_status,
        },
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
