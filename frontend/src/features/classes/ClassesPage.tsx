import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import type { SchoolClass } from "../../types/domain";

export function ClassesPage() {
  const { currentSchoolId } = useAuth();
  const [schoolYearId, setSchoolYearId] = useState<string | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!currentSchoolId) return;
    const { data: year } = await supabase
      .from("school_years")
      .select("id")
      .eq("school_id", currentSchoolId)
      .eq("is_current", true)
      .maybeSingle();
    setSchoolYearId(year?.id ?? null);
    if (!year) {
      setClasses([]);
      return;
    }
    const { data } = await supabase
      .from("classes")
      .select("id, school_year_id, name, level, capacity")
      .eq("school_id", currentSchoolId)
      .eq("school_year_id", year.id)
      .order("level", { ascending: true });
    setClasses(
      (data ?? []).map((c) => ({
        id: c.id,
        schoolYearId: c.school_year_id,
        name: c.name,
        level: c.level,
        capacity: c.capacity,
      })),
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId]);

  async function handleCreate() {
    if (!currentSchoolId || !schoolYearId || !name || !level) return;
    setError(null);
    const { error: insertError } = await supabase.from("classes").insert({
      school_id: currentSchoolId,
      school_year_id: schoolYearId,
      name,
      level,
      capacity: capacity ? parseInt(capacity, 10) : null,
    });
    if (insertError) {
      setError("Impossible de créer la classe (droits insuffisants ou nom déjà utilisé).");
      return;
    }
    setName("");
    setLevel("");
    setCapacity("");
    await load();
  }

  if (!schoolYearId) {
    return (
      <div>
        <h1>Classes</h1>
        <p className="muted">Aucune année scolaire courante définie. Configurez-en une dans Paramètres.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Classes</h1>

      <ul className="list">
        {classes.map((c) => (
          <li key={c.id}>
            {c.name} — {c.level} {c.capacity ? `(capacité ${c.capacity})` : ""}
          </li>
        ))}
        {classes.length === 0 && <li className="muted">Aucune classe pour l'année scolaire en cours.</li>}
      </ul>

      <div className="card">
        <h2>Nouvelle classe</h2>
        <label>
          Nom (ex : CM2 A)
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Niveau (ex : CM2)
          <input value={level} onChange={(e) => setLevel(e.target.value)} />
        </label>
        <label>
          Capacité (optionnel)
          <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button onClick={handleCreate} disabled={!name || !level}>
          Créer
        </button>
      </div>
    </div>
  );
}
