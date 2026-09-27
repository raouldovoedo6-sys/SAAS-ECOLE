import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { formatDate } from "../../lib/format";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  createdAt: string;
}

// Lecture seule : personne ne peut modifier ou supprimer un log d'audit
// (voir RLS — aucune policy write, même pour le directeur).
export function AuditLogPage() {
  const { currentSchoolId } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    supabase
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, reason, created_at")
      .eq("school_id", currentSchoolId)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (cancelled) return;
        setRows(
          (data ?? []).map((r) => ({
            id: r.id,
            action: r.action,
            entityType: r.entity_type,
            entityId: r.entity_id,
            reason: r.reason,
            createdAt: r.created_at,
          })),
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentSchoolId]);

  return (
    <div>
      <h1>Journal d'audit</h1>
      {loading && <p>Chargement…</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Action</th>
            <th>Entité</th>
            <th>Motif</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.createdAt)}</td>
              <td>{r.action}</td>
              <td>
                {r.entityType}
                {r.entityId ? ` (${r.entityId.slice(0, 8)}…)` : ""}
              </td>
              <td className="muted">{r.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && <p className="muted">Aucun événement.</p>}
    </div>
  );
}
