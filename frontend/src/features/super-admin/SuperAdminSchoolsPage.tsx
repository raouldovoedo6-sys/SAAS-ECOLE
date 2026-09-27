import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase/client";
import { callEdgeFunction, EdgeFunctionError } from "../../services/edge-functions/client";

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  status: string;
}

// Réservé au super administrateur SaaS (RLS : schools_select inclut
// is_super_admin()). Permet de créer une nouvelle école et son premier
// directeur sans passer par une manipulation SQL manuelle.
export function SuperAdminSchoolsPage() {
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [schoolSlug, setSchoolSlug] = useState("");
  const [directorEmail, setDirectorEmail] = useState("");
  const [directorFullName, setDirectorFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const { data } = await supabase.from("schools").select("id, name, slug, status").order("name");
    setSchools(data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!schoolName || !schoolSlug || !directorEmail || !directorFullName) return;
    setSubmitting(true);
    setError(null);
    setResultInfo(null);
    try {
      const result = await callEdgeFunction<{
        schoolId: string;
        director: { accountCreated: boolean; temporaryPassword: string | null };
      }>("create-school", { schoolName, schoolSlug, directorEmail, directorFullName });

      setResultInfo(
        result.director.accountCreated && result.director.temporaryPassword
          ? `École créée. Mot de passe temporaire du directeur (${directorEmail}) à transmettre en toute sécurité : ${result.director.temporaryPassword}`
          : "École créée. Le compte directeur existait déjà et a été rattaché.",
      );
      setSchoolName("");
      setSchoolSlug("");
      setDirectorEmail("");
      setDirectorFullName("");
      await load();
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Administration plateforme — Écoles</h1>

      <table className="table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Slug</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {schools.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.slug}</td>
              <td>{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card">
        <h2>Créer une école</h2>
        <label>
          Nom de l'école
          <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
        </label>
        <label>
          Slug (identifiant unique, ex : ecole-sainte-marie)
          <input value={schoolSlug} onChange={(e) => setSchoolSlug(e.target.value)} />
        </label>
        <label>
          Nom complet du directeur
          <input value={directorFullName} onChange={(e) => setDirectorFullName(e.target.value)} />
        </label>
        <label>
          Email du directeur
          <input type="email" value={directorEmail} onChange={(e) => setDirectorEmail(e.target.value)} />
        </label>

        {error && <p className="error-text">{error}</p>}
        {resultInfo && <p className="card">{resultInfo}</p>}

        <button
          onClick={handleCreate}
          disabled={submitting || !schoolName || !schoolSlug || !directorEmail || !directorFullName}
        >
          {submitting ? "Création…" : "Créer l'école"}
        </button>
      </div>
    </div>
  );
}
