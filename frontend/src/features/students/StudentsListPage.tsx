import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import type { Student } from "../../types/domain";

export function StudentsListPage() {
  const { currentSchoolId } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("students")
        .select("id, school_id, student_code, first_name, last_name, status")
        .eq("school_id", currentSchoolId)
        .order("last_name", { ascending: true });

      if (!cancelled) {
        setStudents(
          (data ?? []).map((s) => ({
            id: s.id,
            schoolId: s.school_id,
            studentCode: s.student_code,
            firstName: s.first_name,
            lastName: s.last_name,
            status: s.status,
          })),
        );
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentSchoolId]);

  const filtered = students.filter((s) =>
    `${s.firstName} ${s.lastName} ${s.studentCode}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="page-header">
        <h1>Élèves</h1>
        <Link to="/students/new" className="button">
          + Nouvel élève
        </Link>
      </div>
      <input
        type="search"
        placeholder="Rechercher un élève…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="search-input"
      />

      {loading && <p>Chargement…</p>}

      <ul className="list">
        {filtered.map((s) => (
          <li key={s.id}>
            <Link to={`/students/${s.id}`}>
              {s.lastName} {s.firstName} — <span className="muted">{s.studentCode}</span>
            </Link>
          </li>
        ))}
        {!loading && filtered.length === 0 && <li className="muted">Aucun élève trouvé.</li>}
      </ul>
    </div>
  );
}
