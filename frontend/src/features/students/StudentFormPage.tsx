import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import type { SchoolClass } from "../../types/domain";

export function StudentFormPage() {
  const { currentSchoolId } = useAuth();
  const navigate = useNavigate();

  const [studentCode, setStudentCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"M" | "F" | "other" | "">("");
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState("");
  const [schoolYearId, setSchoolYearId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentSchoolId) return;
    supabase
      .from("school_years")
      .select("id")
      .eq("school_id", currentSchoolId)
      .eq("is_current", true)
      .maybeSingle()
      .then(({ data: year }) => {
        setSchoolYearId(year?.id ?? null);
        if (!year) return;
        supabase
          .from("classes")
          .select("id, school_year_id, name, level, capacity")
          .eq("school_id", currentSchoolId)
          .eq("school_year_id", year.id)
          .then(({ data }) => {
            setClasses(
              (data ?? []).map((c) => ({
                id: c.id,
                schoolYearId: c.school_year_id,
                name: c.name,
                level: c.level,
                capacity: c.capacity,
              })),
            );
          });
      });
  }, [currentSchoolId]);

  async function handleSubmit() {
    if (!currentSchoolId || !studentCode || !firstName || !lastName) return;
    setSubmitting(true);
    setError(null);

    const { data: student, error: studentError } = await supabase
      .from("students")
      .insert({
        school_id: currentSchoolId,
        student_code: studentCode,
        first_name: firstName,
        last_name: lastName,
        dob: dob || null,
        gender: gender || null,
      })
      .select("id")
      .single();

    if (studentError || !student) {
      setError("Impossible de créer l'élève (code déjà utilisé ou droits insuffisants).");
      setSubmitting(false);
      return;
    }

    if (classId && schoolYearId) {
      await supabase.from("student_enrollments").insert({
        school_id: currentSchoolId,
        student_id: student.id,
        school_year_id: schoolYearId,
        class_id: classId,
      });
    }

    navigate(`/students/${student.id}`, { replace: true });
  }

  return (
    <div>
      <h1>Nouvel élève</h1>

      <label>
        Matricule
        <input value={studentCode} onChange={(e) => setStudentCode(e.target.value)} />
      </label>
      <label>
        Prénom
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </label>
      <label>
        Nom
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </label>
      <label>
        Date de naissance
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
      </label>
      <label>
        Genre
        <select value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}>
          <option value="">—</option>
          <option value="M">Masculin</option>
          <option value="F">Féminin</option>
          <option value="other">Autre</option>
        </select>
      </label>
      <label>
        Classe (année scolaire en cours)
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">— Aucune —</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.level})
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error-text">{error}</p>}

      <button onClick={handleSubmit} disabled={submitting || !studentCode || !firstName || !lastName}>
        {submitting ? "Création…" : "Créer l'élève"}
      </button>
    </div>
  );
}
