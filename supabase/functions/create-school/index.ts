import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser, isSuperAdmin } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";
import { findOrCreateAuthUser } from "../_shared/adminUsers.ts";

const bodySchema = z.object({
  schoolName: z.string().min(2).max(200),
  schoolSlug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug invalide (minuscules, chiffres, tirets)."),
  currency: z.string().default("XOF"),
  directorEmail: z.string().email(),
  directorFullName: z.string().min(2).max(200),
});

// Réservé au super administrateur SaaS. Crée l'école ET son premier
// directeur en une seule opération, dans une transaction logique côté
// Edge Function (les étapes sont ordonnées pour rester cohérentes en cas
// d'échec partiel — voir audit_logs pour la traçabilité de cette action
// plateforme sensible).
Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
    if (!(await isSuperAdmin(admin, user.id))) {
      throw new AppError(403, "Action réservée au super administrateur.");
    }

    const body = await parseJsonBody(req, bodySchema);

    const { data: school, error: schoolError } = await admin
      .from("schools")
      .insert({ name: body.schoolName, slug: body.schoolSlug, currency: body.currency })
      .select("id")
      .single();

    if (schoolError || !school) {
      if (schoolError?.code === "23505") {
        throw new AppError(409, "Ce slug d'école est déjà utilisé.");
      }
      throw new AppError(500, "Erreur de création de l'école.", schoolError);
    }

    const { user: directorUser, createdNow, tempPassword } = await findOrCreateAuthUser(
      admin,
      body.directorEmail,
      body.directorFullName,
    );

    const { error: membershipError } = await admin.from("school_users").insert({
      school_id: school.id,
      user_id: directorUser.id,
      role: "director",
      status: "active",
      invited_by: user.id,
    });
    if (membershipError) {
      throw new AppError(500, "École créée, mais rattachement du directeur impossible.", membershipError);
    }

    await writeAuditLog(admin, {
      schoolId: school.id,
      actorUserId: user.id,
      action: "school.create",
      entityType: "schools",
      entityId: school.id,
      newValue: { name: body.schoolName, slug: body.schoolSlug, directorEmail: body.directorEmail },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(
      JSON.stringify({
        schoolId: school.id,
        director: {
          email: body.directorEmail,
          accountCreated: createdNow,
          // Communiqué UNE SEULE FOIS : à transmettre au directeur de façon
          // sûre. Aucune trace de ce mot de passe n'est conservée ailleurs.
          temporaryPassword: tempPassword ?? null,
        },
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
