import { z } from "npm:zod@3";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { requireUser } from "../_shared/auth.ts";
import { parseJsonBody } from "../_shared/validate.ts";
import { AppError, errorResponse } from "../_shared/errors.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { writeAuditLog, clientIp } from "../_shared/audit.ts";

const bodySchema = z.object({
  schoolName: z.string().min(2).max(200),
  schoolSlug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug invalide (minuscules, chiffres, tirets)."),
  currency: z.string().default("XOF"),
});

// Auto-inscription : n'importe quel utilisateur authentifié peut créer SA
// PROPRE école et en devenir directeur, sans validation d'un super admin
// (voir clarification produit : le super admin n'a qu'un rôle de
// supervision/analytique de la plateforme, jamais de création d'école).
// Contrairement à create-school (réservé au super admin, qui crée un
// compte directeur pour un tiers), ici l'appelant devient lui-même le
// directeur de l'école qu'il crée.
Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  try {
    const user = await requireUser(req, admin);
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

    const { error: membershipError } = await admin.from("school_users").insert({
      school_id: school.id,
      user_id: user.id,
      role: "director",
      status: "active",
    });
    if (membershipError) {
      throw new AppError(500, "École créée, mais rattachement du compte impossible.", membershipError);
    }

    await writeAuditLog(admin, {
      schoolId: school.id,
      actorUserId: user.id,
      action: "school.self_register",
      entityType: "schools",
      entityId: school.id,
      newValue: { name: body.schoolName, slug: body.schoolSlug },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(JSON.stringify({ schoolId: school.id }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
