import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Erreur volontairement bruyante en développement : mieux vaut un crash
  // explicite qu'un client mal configuré qui échouerait silencieusement.
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants (voir .env.example).");
}

// Client "anon" uniquement : toute la sécurité repose sur les policies RLS
// exécutées côté PostgreSQL, jamais sur une vérification faite ici.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
