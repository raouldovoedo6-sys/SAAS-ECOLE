import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";

interface YearRow {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  isCurrent: boolean;
}

// Créer une nouvelle année scolaire n'écrase jamais les données
// historiques : chaque facture/paiement reste rattaché à son
// school_year_id d'origine (voir docs/ARCHITECTURE.md §5.9).
export function SchoolYearsPage() {
  const { currentSchoolId } = useAuth();
  const [years, setYears] = useState<YearRow[]>([]);
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!currentSchoolId) return;
    const { data } = await supabase
      .from("school_years")
      .select("id, label, start_date, end_date, status, is_current")
      .eq("school_id", currentSchoolId)
      .order("start_date", { ascending: false });
    setYears(
      (data ?? []).map((y) => ({
        id: y.id,
        label: y.label,
        startDate: y.start_date,
        endDate: y.end_date,
        status: y.status,
        isCurrent: y.is_current,
      })),
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId]);

  async function handleCreate() {
    if (!currentSchoolId || !label || !startDate || !endDate) return;
    setError(null);
    const { error: insertError } = await supabase.from("school_years").insert({
      school_id: currentSchoolId,
      label,
      start_date: startDate,
      end_date: endDate,
      status: "draft",
    });
    if (insertError) {
      setError("Impossible de créer l'année scolaire (libellé déjà utilisé ?).");
      return;
    }
    setLabel("");
    setStartDate("");
    setEndDate("");
    await load();
  }

  async function makeCurrent(yearId: string) {
    setError(null);
    // Un seul index partiel garantit qu'une seule année est "courante" par
    // école côté base ; on désactive d'abord les autres pour éviter le
    // conflit, dans deux requêtes successives (pas de transaction
    // multi-requêtes possible via PostgREST, mais le pire cas transitoire
    // — 0 année courante un instant — n'a aucun impact financier).
    await supabase.from("school_years").update({ is_current: false }).eq("school_id", currentSchoolId!).eq("is_current", true);
    const { error: updateError } = await supabase
      .from("school_years")
      .update({ is_current: true, status: "active" })
      .eq("id", yearId);
    if (updateError) {
      setError("Impossible de définir cette année comme courante.");
    }
    await load();
  }

  return (
    <div>
      <h1>Années scolaires</h1>

      <table className="table">
        <thead>
          <tr>
            <th>Libellé</th>
            <th>Début</th>
            <th>Fin</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.id}>
              <td>{y.label}</td>
              <td>{y.startDate}</td>
              <td>{y.endDate}</td>
              <td>
                {y.status} {y.isCurrent && <span className="badge">Courante</span>}
              </td>
              <td>
                {!y.isCurrent && <button onClick={() => makeCurrent(y.id)}>Définir comme courante</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card">
        <h2>Nouvelle année scolaire</h2>
        <label>
          Libellé (ex : 2026-2027)
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          Début
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          Fin
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button onClick={handleCreate} disabled={!label || !startDate || !endDate}>
          Créer
        </button>
      </div>
    </div>
  );
}
