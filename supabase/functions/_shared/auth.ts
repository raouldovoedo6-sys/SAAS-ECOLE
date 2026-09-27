import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";
import { AppError } from "./errors.ts";

// Extrait et valide le JWT utilisateur transmis par le frontend, via
// l'API Auth de Supabase (ne fait JAMAIS confiance à un rôle/école déclaré
// par le client : uniquement l'identité, le reste est rechargé en base).
export async function requireUser(req: Request, admin: SupabaseClient): Promise<User> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    throw new AppError(401, "Authentification requise.");
  }

  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) {
    throw new AppError(401, "Session invalide ou expirée.");
  }
  return data.user;
}

// Revalide le rôle réel de l'utilisateur pour l'école concernée, à partir
// de school_users (jamais depuis une valeur envoyée par le client).
export async function requireSchoolRole(
  admin: SupabaseClient,
  userId: string,
  schoolId: string,
  allowedRoles: string[],
): Promise<string> {
  const { data, error } = await admin
    .from("school_users")
    .select("role")
    .eq("user_id", userId)
    .eq("school_id", schoolId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new AppError(500, "Erreur de vérification des droits.", error);
  }
  if (!data || !allowedRoles.includes(data.role)) {
    throw new AppError(403, "Action non autorisée pour ce rôle.");
  }
  return data.role as string;
}

export async function isSuperAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
