import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, requireSchoolRole } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";
import { findOrCreateAuthUser } from "../_shared/adminUsers.ts";

const bodySchema = z.object({
  schoolId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().min(2).max(200),
  role: z.enum(["director", "accountant", "admin_staff", "parent"]),
  permissions: z.record(z.boolean()).optional(),
});

// Seul le directeur peut inviter (créer un rattachement école + rôle).
// Comme pour create-school, aucun email n'est envoyé (fournisseur non
// retenu pour le MVP) : un mot de passe temporaire est renvoyé une seule
// fois si un nouveau compte est créé.
Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    const body = await parseJsonBody(req, bodySchema);

    await requireSchoolRole(admin, user.id, body.schoolId, ["director"]);

    const { user: invitedUser, createdNow, tempPassword } = await findOrCreateAuthUser(
      admin,
      body.email,
      body.fullName,
    );

    const { data: existingMembership } = await admin
      .from("school_users")
      .select("id")
      .eq("school_id", body.schoolId)
      .eq("user_id", invitedUser.id)
      .maybeSingle();

    if (existingMembership) {
      const { error: updateError } = await admin
        .from("school_users")
        .update({ role: body.role, status: "active", permissions: body.permissions ?? {} })
        .eq("id", existingMembership.id);
      if (updateError) throw new AppError(500, "Erreur de mise à jour du rattachement.", updateError);
    } else {
      const { error: insertError } = await admin.from("school_users").insert({
        school_id: body.schoolId,
        user_id: invitedUser.id,
        role: body.role,
        status: "active",
        permissions: body.permissions ?? {},
        invited_by: user.id,
      });
      if (insertError) throw new AppError(500, "Erreur de création du rattachement.", insertError);
    }

    await writeAuditLog(admin, {
      schoolId: body.schoolId,
      actorUserId: user.id,
      action: "school_users.invite",
      entityType: "school_users",
      entityId: invitedUser.id,
      newValue: { email: body.email, role: body.role },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(
      JSON.stringify({
        userId: invitedUser.id,
        accountCreated: createdNow,
        temporaryPassword: tempPassword ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
