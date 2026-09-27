import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase/client";
import { formatAmount, formatDate } from "../../lib/format";

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}

// Le super administrateur ne crée plus les écoles (chaque directeur
// s'inscrit lui-même, voir SignUpPage / Edge Function register-school) :
// cet écran est volontairement en lecture seule, réservé au suivi du
// trafic et de la croissance de la plateforme.
export function SuperAdminDashboardPage() {
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [studentsCount, setStudentsCount] = useState<number | null>(null);
  const [totalInvoiced, setTotalInvoiced] = useState(0);
  const [totalCollected, setTotalCollected] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data: schoolRows } = await supabase
        .from("schools")
        .select("id, name, slug, status, created_at")
        .order("created_at", { ascending: false });

      const { count } = await supabase.from("students").select("id", { count: "exact", head: true });

      const { data: invoiceRows } = await supabase.from("invoices").select("total_amount, paid_amount");

      if (cancelled) return;

      setSchools(
        (schoolRows ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          status: s.status,
          createdAt: s.created_at,
        })),
      );
      setStudentsCount(count ?? 0);
      setTotalInvoiced((invoiceRows ?? []).reduce((sum, i) => sum + i.total_amount, 0));
      setTotalCollected((invoiceRows ?? []).reduce((sum, i) => sum + i.paid_amount, 0));
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1>Administration plateforme</h1>
      <p className="muted">
        Vue de supervision uniquement : chaque école s'inscrit elle-même depuis la page d'accueil. Aucune action de
        création n'est disponible ici.
      </p>

      {loading && <p>Chargement…</p>}

      {!loading && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">Écoles inscrites</span>
            <span className="kpi-value">{schools.length}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Élèves (toutes écoles)</span>
            <span className="kpi-value">{studentsCount}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Total facturé (plateforme)</span>
            <span className="kpi-value">{formatAmount(totalInvoiced)}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Total recouvré (plateforme)</span>
            <span className="kpi-value">{formatAmount(totalCollected)}</span>
          </div>
        </div>
      )}

      <h2>Écoles inscrites</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Slug</th>
            <th>Statut</th>
            <th>Inscrite le</th>
          </tr>
        </thead>
        <tbody>
          {schools.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.slug}</td>
              <td>{s.status}</td>
              <td>{formatDate(s.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && schools.length === 0 && <p className="muted">Aucune école inscrite pour le moment.</p>}
    </div>
  );
}
