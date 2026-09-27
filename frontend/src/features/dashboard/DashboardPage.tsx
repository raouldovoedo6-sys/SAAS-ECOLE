import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { formatAmount } from "../../lib/format";

interface InvoiceRow {
  id: string;
  student_id: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  issue_date: string;
}

type ViewMode = "year" | "quarter";

// Le directeur doit toujours savoir explicitement s'il regarde le cumul de
// l'année scolaire ou une période trimestrielle : les deux vues ne sont
// JAMAIS mélangées silencieusement (voir docs/ARCHITECTURE.md §14).
export function DashboardPage() {
  const { currentSchoolId } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("year");
  const [quarterStart, setQuarterStart] = useState<string>("");
  const [quarterEnd, setQuarterEnd] = useState<string>("");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: schoolYear } = await supabase
        .from("school_years")
        .select("id, start_date, end_date")
        .eq("school_id", currentSchoolId)
        .eq("is_current", true)
        .maybeSingle();

      if (!schoolYear) {
        if (!cancelled) {
          setInvoices([]);
          setLoading(false);
        }
        return;
      }

      let query = supabase
        .from("invoices")
        .select("id, student_id, total_amount, paid_amount, status, issue_date")
        .eq("school_id", currentSchoolId)
        .eq("school_year_id", schoolYear.id);

      if (viewMode === "quarter" && quarterStart && quarterEnd) {
        query = query.gte("issue_date", quarterStart).lte("issue_date", quarterEnd);
      }

      const { data, error: queryError } = await query;
      if (cancelled) return;

      if (queryError) {
        setError("Erreur de chargement des données financières.");
      } else {
        setInvoices(data ?? []);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentSchoolId, viewMode, quarterStart, quarterEnd]);

  const stats = useMemo(() => {
    const totalInvoiced = invoices.reduce((sum, i) => sum + i.total_amount, 0);
    const totalCollected = invoices.reduce((sum, i) => sum + i.paid_amount, 0);
    const totalOutstanding = totalInvoiced - totalCollected;
    const collectionRate = totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;
    const overdueCount = invoices.filter((i) => i.status === "overdue").length;
    const studentsWithUnpaid = new Set(
      invoices.filter((i) => i.total_amount - i.paid_amount > 0).map((i) => i.student_id),
    ).size;

    return { totalInvoiced, totalCollected, totalOutstanding, collectionRate, overdueCount, studentsWithUnpaid };
  }, [invoices]);

  return (
    <div>
      <h1>Tableau de bord financier</h1>

      <div className="view-toggle">
        <button className={viewMode === "year" ? "active" : ""} onClick={() => setViewMode("year")}>
          Cumul année scolaire
        </button>
        <button className={viewMode === "quarter" ? "active" : ""} onClick={() => setViewMode("quarter")}>
          Trimestre
        </button>
      </div>

      {viewMode === "quarter" && (
        <div className="quarter-picker">
          <label>
            Du
            <input type="date" value={quarterStart} onChange={(e) => setQuarterStart(e.target.value)} />
          </label>
          <label>
            Au
            <input type="date" value={quarterEnd} onChange={(e) => setQuarterEnd(e.target.value)} />
          </label>
        </div>
      )}

      {loading && <p>Chargement…</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">Total facturé</span>
            <span className="kpi-value">{formatAmount(stats.totalInvoiced)}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Total recouvré</span>
            <span className="kpi-value">{formatAmount(stats.totalCollected)}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Restant à recouvrer</span>
            <span className="kpi-value">{formatAmount(stats.totalOutstanding)}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Taux de recouvrement</span>
            <span className="kpi-value">{stats.collectionRate.toFixed(1)} %</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Élèves avec impayés</span>
            <span className="kpi-value">{stats.studentsWithUnpaid}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Factures en retard</span>
            <span className="kpi-value">{stats.overdueCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
