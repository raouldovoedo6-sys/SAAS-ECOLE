import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

let cached: SupabaseClient | null = null;

// Client service_role : à n'utiliser QUE côté Edge Function. Cette clé ne
// doit jamais transiter vers le frontend (voir docs/ARCHITECTURE.md §8/§17).
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Secrets SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants.");
  }

  cached = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
