import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";

// Sans fournisseur email configuré (voir docs/ARCHITECTURE.md), l'invitation
// d'un nouvel utilisateur ne peut pas passer par un lien magique envoyé par
// courriel. À la place, un mot de passe temporaire est généré et renvoyé
// UNE SEULE FOIS à la personne qui invite (directeur ou super admin), à elle
// de le transmettre de façon sûre (de vive voix, message manuel, etc.). La
// personne invitée doit le changer dès sa première connexion.
export function generateTempPassword(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16) + "Aa1!";
}

export async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 1000;

  // Pas d'API "getUserByEmail" côté admin Supabase JS : on pagine sur
  // listUsers. Suffisant pour l'échelle d'une école (quelques centaines
  // d'utilisateurs) ; à revoir si la volumétrie augmente fortement.
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const found = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

// Retourne { user, createdNow, tempPassword? } : createdNow indique si un
// nouveau compte vient d'être créé (auquel cas un mot de passe temporaire
// est fourni), ou si un compte existant a été réutilisé (aucun mot de passe
// à communiquer, la personne utilise déjà ses identifiants habituels).
export async function findOrCreateAuthUser(
  admin: SupabaseClient,
  email: string,
  fullName: string,
): Promise<{ user: User; createdNow: boolean; tempPassword?: string }> {
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) {
    return { user: existing, createdNow: false };
  }

  const tempPassword = generateTempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    throw error ?? new Error("Création du compte utilisateur impossible.");
  }
  return { user: data.user, createdNow: true, tempPassword };
}
