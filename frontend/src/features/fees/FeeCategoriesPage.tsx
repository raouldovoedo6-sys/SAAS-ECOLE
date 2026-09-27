import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import type { FeeCategory } from "../../types/domain";

export function FeeCategoriesPage() {
  const { currentSchoolId } = useAuth();
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!currentSchoolId) return;
    const { data } = await supabase
      .from("fee_categories")
      .select("id, code, name")
      .eq("school_id", currentSchoolId)
      .order("name", { ascending: true });
    setCategories(data ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId]);

  async function handleCreate() {
    if (!currentSchoolId || !code || !name) return;
    setError(null);
    const { error: insertError } = await supabase
      .from("fee_categories")
      .insert({ school_id: currentSchoolId, code: code.toLowerCase().trim(), name });
    if (insertError) {
      setError("Impossible de créer cette catégorie (code déjà utilisé ?).");
      return;
    }
    setCode("");
    setName("");
    await load();
  }

  return (
    <div>
      <h1>Catégories de frais</h1>
      <ul className="list">
        {categories.map((c) => (
          <li key={c.id}>
            {c.name} <span className="muted">({c.code})</span>
          </li>
        ))}
        {categories.length === 0 && <li className="muted">Aucune catégorie.</li>}
      </ul>

      <div className="card">
        <h2>Nouvelle catégorie</h2>
        <label>
          Nom (ex : Scolarité, Cantine, Transport…)
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Code (ex : tuition, canteen, transport)
          <input value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button onClick={handleCreate} disabled={!code || !name}>
          Créer
        </button>
      </div>
    </div>
  );
}
