import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { formatDate } from "../../lib/format";

interface NotificationRow {
  id: string;
  channel: string;
  type: string;
  status: string;
  scheduledFor: string;
  failureReason: string | null;
  guardianName: string;
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Programmée",
  queued: "En file",
  sent: "Envoyée",
  delivered: "Distribuée",
  failed: "Échec",
  cancelled: "Annulée",
};

export function NotificationsHistoryPage() {
  const { currentSchoolId } = useAuth();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    supabase
      .from("notifications")
      .select("id, channel, type, status, scheduled_for, failure_reason, guardians(first_name, last_name)")
      .eq("school_id", currentSchoolId)
      .order("scheduled_for", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (cancelled) return;
        setRows(
          (data ?? []).map((n) => {
            const guardian = Array.isArray(n.guardians) ? n.guardians[0] : n.guardians;
            return {
              id: n.id,
              channel: n.channel,
              type: n.type,
              status: n.status,
              scheduledFor: n.scheduled_for,
              failureReason: n.failure_reason,
              guardianName: guardian ? `${guardian.first_name} ${guardian.last_name}` : "—",
            };
          }),
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentSchoolId]);

  const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

  return (
    <div>
      <h1>Historique des notifications</h1>

      <label>
        Statut
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Tous</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {loading && <p>Chargement…</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Responsable</th>
            <th>Type</th>
            <th>Canal</th>
            <th>Prévue le</th>
            <th>Statut</th>
            <th>Détail échec</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((n) => (
            <tr key={n.id}>
              <td>{n.guardianName}</td>
              <td>{n.type}</td>
              <td>{n.channel}</td>
              <td>{formatDate(n.scheduledFor)}</td>
              <td>
                <span className={`badge badge-${n.status}`}>{STATUS_LABELS[n.status] ?? n.status}</span>
              </td>
              <td className="muted">{n.failureReason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && filtered.length === 0 && <p className="muted">Aucune notification.</p>}
    </div>
  );
}
