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

    const { data, error } = await admin.rpc("fn_reject_payment", {
      p_payment_id: body.paymentId,
      p_school_id: body.schoolId,
      p_actor_user_id: user.id,
      p_reason: body.reason,
    });

    if (error) {
      throw new AppError(400, error.message);
    }

    const result = Array.isArray(data) ? data[0] : data;

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "payment.reject",
      entityType: "payments",
      entityId: body.paymentId,
      reason: body.reason,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(
      JSON.stringify({ payment: { id: result?.out_payment_id, status: result?.status } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
