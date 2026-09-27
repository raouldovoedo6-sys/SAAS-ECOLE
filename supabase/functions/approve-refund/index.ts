import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  refundId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  decisionReason: z.string().max(500).nullable().optional(),
});

// Approbation réservée au directeur (§6 : toute réduction/remboursement
// important doit être soumis à approbation).
Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    await requireSchoolRole(admin, user.id, body.schoolId, ["director"]);

    const { data, error } = await admin.rpc("fn_approve_refund", {
      p_refund_id: body.refundId,
      p_school_id: body.schoolId,
      p_actor_user_id: user.id,
      p_decision: body.decision,
      p_decision_reason: body.decisionReason ?? null,
    });
    if (error) throw new AppError(400, error.message);

    const result = Array.isArray(data) ? data[0] : data;

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "refund.decide",
      entityType: "refunds",
      entityId: body.refundId,
      newValue: { decision: body.decision, reason: body.decisionReason ?? null },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(
      JSON.stringify({ refund: { id: result?.out_refund_id, status: result?.status } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
