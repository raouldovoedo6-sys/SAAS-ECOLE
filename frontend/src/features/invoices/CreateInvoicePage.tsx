import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { callEdgeFunction, EdgeFunctionError } from "../../services/edge-functions/client";
import { formatAmount } from "../../lib/format";
import type { Student } from "../../types/domain";

interface InstallmentOption {
  id: string;
  label: string;
  scheduleLabel: string;
  amount: number;
  dueDate: string;
}

// Le montant final n'est jamais calculé ici : le formulaire ne fait que
// sélectionner QUELLES tranches facturer. Le montant réel (après
// réduction/exonération éventuelle) est recalculé côté serveur par
// l'Edge Function create-invoice, à partir des tarifs et affectations en
// base (voir docs/ARCHITECTURE.md §18).
export function CreateInvoicePage() {
  const { currentSchoolId } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedStudentId = searchParams.get("studentId");

  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState(preselectedStudentId ?? "");
  const [installments, setInstallments] = useState<InstallmentOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [schoolYearId, setSchoolYearId] = useState<string | null>(null);
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentSchoolId) return;
    supabase
      .from("students")
      .select("id, school_id, student_code, first_name, last_name, status")
      .eq("school_id", currentSchoolId)
      .then(({ data }) => {
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
      });
  }, [currentSchoolId]);

  useEffect(() => {
    if (!currentSchoolId || !studentId) {
      setInstallments([]);
      return;
    }

    async function load() {
      const { data: year } = await supabase
        .from("school_years")
        .select("id")
        .eq("school_id", currentSchoolId)
        .eq("is_current", true)
        .maybeSingle();
      setSchoolYearId(year?.id ?? null);
      if (!year) return;

      const { data: assignments } = await supabase
        .from("student_fee_assignments")
        .select("fee_schedule_id")
        .eq("student_id", studentId)
        .eq("school_year_id", year.id);
      const scheduleIds = (assignments ?? []).map((a) => a.fee_schedule_id);
      if (scheduleIds.length === 0) {
        setInstallments([]);
        return;
      }

      const { data: rows } = await supabase
        .from("fee_installments")
        .select("id, label, amount, due_date, fee_schedules(label)")
        .in("fee_schedule_id", scheduleIds)
        .order("due_date", { ascending: true });

      const { data: alreadyInvoiced } = await supabase
        .from("invoice_items")
        .select("fee_installment_id, invoices!inner(status, student_id)")
        .eq("invoices.student_id", studentId)
        .neq("invoices.status", "cancelled");
      const invoicedIds = new Set((alreadyInvoiced ?? []).map((r) => r.fee_installment_id));

      const { data: primaryGuardian } = await supabase
        .from("student_guardians")
        .select("guardian_id")
        .eq("student_id", studentId)
        .eq("is_primary", true)
        .maybeSingle();
      setGuardianId(primaryGuardian?.guardian_id ?? null);

      setInstallments(
        (rows ?? [])
          .filter((r) => !invoicedIds.has(r.id))
          .map((r) => {
            const schedule = Array.isArray(r.fee_schedules) ? r.fee_schedules[0] : r.fee_schedules;
            return {
              id: r.id,
              label: r.label,
              scheduleLabel: schedule?.label ?? "",
              amount: r.amount,
              dueDate: r.due_date,
            };
          }),
      );
      setSelected(new Set());
    }

    load();
  }, [currentSchoolId, studentId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!currentSchoolId || !studentId || !schoolYearId || selected.size === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await callEdgeFunction<{ invoice: { invoice_id: string } }>("create-invoice", {
        schoolId: currentSchoolId,
        studentId,
        schoolYearId,
        guardianId,
        feeInstallmentIds: Array.from(selected),
      });
      navigate(`/invoices?studentId=${studentId}`, { replace: true });
      void result;
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedTotal = installments
    .filter((i) => selected.has(i.id))
    .reduce((sum, i) => sum + i.amount, 0);

  return (
    <div>
      <h1>Nouvelle facture</h1>

      <label>
        Élève
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">— Choisir —</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.lastName} {s.firstName} ({s.studentCode})
            </option>
          ))}
        </select>
      </label>

      {studentId && (
        <div className="card">
          <h2>Frais à facturer</h2>
          {installments.length === 0 && (
            <p className="muted">Aucun frais restant à facturer pour l'année scolaire en cours.</p>
          )}
          <ul className="checkbox-list">
            {installments.map((inst) => (
              <li key={inst.id}>
                <label>
                  <input type="checkbox" checked={selected.has(inst.id)} onChange={() => toggle(inst.id)} />
                  {inst.scheduleLabel} — {inst.label} ({formatAmount(inst.amount)}, échéance{" "}
                  {new Date(inst.dueDate).toLocaleDateString("fr-FR")})
                </label>
              </li>
            ))}
          </ul>
          {selected.size > 0 && (
            <p>
              <strong>Montant indicatif sélectionné : {formatAmount(selectedTotal)}</strong>{" "}
              <span className="muted">(le montant définitif, incluant réductions éventuelles, est calculé par le serveur)</span>
            </p>
          )}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <button onClick={handleSubmit} disabled={submitting || selected.size === 0}>
        {submitting ? "Création…" : "Créer la facture"}
      </button>
    </div>
  );
}
