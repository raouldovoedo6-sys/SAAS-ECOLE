import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  role: z.enum(["director", "accountant", "admin_staff", "parent"]),
  permissions: z.record(z.boolean()).optional(),
  status: z.enum(["invited", "active", "suspended"]).default("active"),
});

// Seul le directeur peut changer un rôle ou des permissions. Cette
// opération ne passe JAMAIS par une policy RLS cliente (voir migration
// RLS : school_users n'a aucune policy write pour 'authenticated') afin
// qu'un utilisateur ne puisse jamais modifier son propre rôle ou
// school_id depuis le navigateur, même en cas de bug frontend.
Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    await requireSchoolRole(admin, user.id, body.schoolId, ["director"]);

    if (body.targetUserId === user.id) {
      throw new AppError(400, "Vous ne pouvez pas modifier votre propre rôle.");
    }

    const { data: existing, error: findError } = await admin
      .from("school_users")
      .select("id, role, status, permissions")
      .eq("school_id", body.schoolId)
      .eq("user_id", body.targetUserId)
      .maybeSingle();

    if (findError) throw new AppError(500, "Erreur de lecture des droits existants.", findError);

    let oldValue: unknown = null;

    if (existing) {
      oldValue = { role: existing.role, status: existing.status, permissions: existing.permissions };
      const { error: updateError } = await admin
        .from("school_users")
        .update({ role: body.role, status: body.status, permissions: body.permissions ?? {} })
        .eq("id", existing.id);
      if (updateError) throw new AppError(500, "Erreur de mise à jour du rôle.", updateError);
    } else {
      const { error: insertError } = await admin.from("school_users").insert({
        school_id: body.schoolId,
        user_id: body.targetUserId,
        role: body.role,
        status: body.status,
        permissions: body.permissions ?? {},
        invited_by: user.id,
      });
      if (insertError) throw new AppError(500, "Erreur de création du rattachement école.", insertError);
    }

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "school_users.role_change",
      entityType: "school_users",
      entityId: body.targetUserId,
      oldValue,
      newValue: { role: body.role, status: body.status, permissions: body.permissions ?? {} },
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
