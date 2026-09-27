import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { formatAmount } from "../../lib/format";

interface ScheduleRow {
  id: string;
  label: string;
  totalAmount: number;
  currency: string;
  categoryName: string;
  installmentsCount: number;
}

export function FeeSchedulesPage() {
  const { currentSchoolId } = useAuth();
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data: year } = await supabase
        .from("school_years")
        .select("id")
        .eq("school_id", currentSchoolId)
        .eq("is_current", true)
        .maybeSingle();
      if (!year) {
        if (!cancelled) {
          setSchedules([]);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase
        .from("fee_schedules")
        .select("id, label, total_amount, currency, fee_categories(name), fee_installments(id)")
        .eq("school_id", currentSchoolId)
        .eq("school_year_id", year.id);

      if (cancelled) return;
      setSchedules(
        (data ?? []).map((s) => {
          const category = Array.isArray(s.fee_categories) ? s.fee_categories[0] : s.fee_categories;
          const installments = Array.isArray(s.fee_installments) ? s.fee_installments : [];
          return {
            id: s.id,
            label: s.label,
            totalAmount: s.total_amount,
            currency: s.currency,
            categoryName: category?.name ?? "",
            installmentsCount: installments.length,
          };
        }),
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentSchoolId]);

  return (
    <div>
      <div className="page-header">
        <h1>Tarifs</h1>
        <Link to="/fees/schedules/new" className="button">
          + Nouveau tarif
        </Link>
      </div>

      {loading && <p>Chargement…</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Catégorie</th>
            <th>Libellé</th>
            <th>Montant total</th>
            <th>Tranches</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id}>
              <td>{s.categoryName}</td>
              <td>{s.label}</td>
              <td>{formatAmount(s.totalAmount, s.currency)}</td>
              <td>{s.installmentsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && schedules.length === 0 && (
        <p className="muted">Aucun tarif pour l'année scolaire en cours.</p>
      )}
    </div>
  );
}
