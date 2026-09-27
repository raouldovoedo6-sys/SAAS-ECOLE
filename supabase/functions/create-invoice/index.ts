import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
  schoolYearId: z.string().uuid(),
  guardianId: z.string().uuid().nullable().optional(),
  feeInstallmentIds: z.array(z.string().uuid()).min(1),
});

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

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "invoice.create",
      entityType: "invoices",
      entityId: result?.invoice_id ?? null,
      newValue: { total_amount: result?.total_amount, fee_installment_ids: body.feeInstallmentIds },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(JSON.stringify({ invoice: result }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
