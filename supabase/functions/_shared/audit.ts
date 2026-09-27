import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface AuditEntry {
  schoolId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Écrit une ligne d'audit. N'échoue jamais l'opération métier appelante :
// un incident d'écriture d'audit est journalisé côté serveur pour
// investigation, mais ne doit pas annuler une opération financière déjà
// commise. Les tables d'audit sont append-only (voir migrations RLS).
export async function writeAuditLog(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await admin.from("audit_logs").insert({
    school_id: entry.schoolId ?? null,
    actor_user_id: entry.actorUserId ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    reason: entry.reason ?? null,
    ip_address: entry.ipAddress ?? null,
    user_agent: entry.userAgent ?? null,
  });
  if (error) {
    console.error("[audit_logs insert failed]", entry.action, error);
  }
}

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
