import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().min(3).max(500),
});

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    await requireSchoolRole(admin, user.id, body.schoolId, ["director", "accountant"]);

    const { data, error } = await admin.rpc("fn_request_refund", {
      p_school_id: body.schoolId,
      p_payment_id: body.paymentId,
      p_amount: body.amount,
      p_reason: body.reason,
      p_requested_by: user.id,
    });
    if (error) throw new AppError(400, error.message);

    const result = Array.isArray(data) ? data[0] : data;

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "refund.request",
      entityType: "refunds",
      entityId: result?.out_refund_id ?? null,
      newValue: { amount: body.amount, reason: body.reason, payment_id: body.paymentId },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(
      JSON.stringify({ refund: { id: result?.out_refund_id, status: result?.out_status } }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
