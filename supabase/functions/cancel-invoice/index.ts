import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    // Annulation réservée au directeur : une facture reflète un engagement
    // financier, sa suppression pure et simple n'est jamais autorisée (voir
    // fn_cancel_invoice, qui refuse toute annulation si des paiements ont
    // déjà été confirmés dessus).
    await requireSchoolRole(admin, user.id, body.schoolId, ["director"]);

    const { error } = await admin.rpc("fn_cancel_invoice", {
      p_invoice_id: body.invoiceId,
      p_school_id: body.schoolId,
      p_actor_user_id: user.id,
      p_reason: body.reason,
    });

    if (error) throw new AppError(400, error.message);

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "invoice.cancel",
      entityType: "invoices",
      entityId: body.invoiceId,
      reason: body.reason,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
