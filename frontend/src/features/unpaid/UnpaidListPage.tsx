import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { formatAmount, formatDate } from "../../lib/format";
import type { SchoolClass } from "../../types/domain";

interface UnpaidRow {
  invoiceId: string;
  invoiceNumber: string;
  studentName: string;
  className: string;
  classId: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  daysLate: number;
}

export function UnpaidListPage() {
  const { currentSchoolId } = useAuth();
  const [rows, setRows] = useState<UnpaidRow[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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

      if (year) {
        const { data: classRows } = await supabase
          .from("classes")
          .select("id, school_year_id, name, level, capacity")
          .eq("school_id", currentSchoolId)
          .eq("school_year_id", year.id);
        if (!cancelled) {
          setClasses(
            (classRows ?? []).map((c) => ({
              id: c.id,
              schoolYearId: c.school_year_id,
              name: c.name,
              level: c.level,
              capacity: c.capacity,
            })),
          );
        }
      }

      const { data: invoiceRows } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, due_date, total_amount, paid_amount, status, students(first_name, last_name, student_enrollments(class_id, school_year_id, classes(name)))",
        )
        .eq("school_id", currentSchoolId)
        .in("status", ["issued", "partially_paid", "overdue"]);

      if (cancelled) return;

      const today = new Date();
      const parsed: UnpaidRow[] = (invoiceRows ?? [])
        .filter((i) => i.total_amount - i.paid_amount > 0)
        .map((i) => {
          const student = Array.isArray(i.students) ? i.students[0] : i.students;
          const enrollments = student ? (Array.isArray(student.student_enrollments) ? student.student_enrollments : []) : [];
          const currentEnrollment = year ? enrollments.find((e) => e.school_year_id === year.id) : enrollments[0];
          const cls = currentEnrollment
            ? Array.isArray(currentEnrollment.classes)
              ? currentEnrollment.classes[0]
              : currentEnrollment.classes
            : null;
          const due = new Date(i.due_date);
          const daysLate = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));

          return {
            invoiceId: i.id,
            invoiceNumber: i.invoice_number,
            studentName: student ? `${student.first_name} ${student.last_name}` : "",
            className: cls?.name ?? "—",
            classId: currentEnrollment?.class_id ?? "",
            dueDate: i.due_date,
            totalAmount: i.total_amount,
            paidAmount: i.paid_amount,
            status: i.status,
            daysLate,
          };
        });

      setRows(parsed);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentSchoolId]);

  const filtered = rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (classFilter && (r as UnpaidRow & { classId?: string }).classId !== classFilter) return false;
    return true;
  });

  return (
    <div>
      <h1>Impayés</h1>

      <div className="quarter-picker">
        <label>
          Classe
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">Toutes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Statut
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Tous</option>
            <option value="issued">Émise</option>
            <option value="partially_paid">Partiellement payée</option>
            <option value="overdue">En retard</option>
          </select>
        </label>
      </div>

      {loading && <p>Chargement…</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Élève</th>
            <th>Classe</th>
            <th>Facture</th>
            <th>Échéance</th>
            <th>Total</th>
            <th>Payé</th>
            <th>Solde</th>
            <th>Retard (j)</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.invoiceId}>
              <td>{r.studentName}</td>
              <td>{r.className}</td>
              <td>{r.invoiceNumber}</td>
              <td>{formatDate(r.dueDate)}</td>
              <td>{formatAmount(r.totalAmount)}</td>
              <td>{formatAmount(r.paidAmount)}</td>
              <td>{formatAmount(r.totalAmount - r.paidAmount)}</td>
              <td>{r.daysLate > 0 ? r.daysLate : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && filtered.length === 0 && <p className="muted">Aucun impayé.</p>}
    </div>
  );
}
