import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { callEdgeFunction, EdgeFunctionError } from "../../services/edge-functions/client";
import { formatAmount } from "../../lib/format";
import type { Student } from "../../types/domain";

interface OpenInvoice {
  id: string;
  invoiceNumber: string;
  balance: number;
}

export function RecordPaymentPage() {
  const { currentSchoolId } = useAuth();
  const navigate = useNavigate();

  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [schoolYearId, setSchoolYearId] = useState<string | null>(null);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "mobile_money" | "bank_transfer" | "cheque" | "other">(
    "cash",
  );
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [idempotencyKey] = useState(() => crypto.randomUUID());
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
      setOpenInvoices([]);
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

      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, total_amount, paid_amount, status")
        .eq("school_id", currentSchoolId)
        .eq("student_id", studentId)
        .in("status", ["issued", "partially_paid", "overdue"]);

      setOpenInvoices(
        (data ?? []).map((i) => ({
          id: i.id,
          invoiceNumber: i.invoice_number,
          balance: i.total_amount - i.paid_amount,
        })),
      );
      setAllocations({});
    }

    load();
  }, [currentSchoolId, studentId]);

  const totalAllocated = useMemo(
    () => Object.values(allocations).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
    [allocations],
  );

  async function handleSubmit() {
    if (!currentSchoolId || !studentId || !schoolYearId) return;
    const allocationList = Object.entries(allocations)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([invoiceId, v]) => ({ invoiceId, amount: parseFloat(v) }));

    if (allocationList.length === 0) {
      setError("Veuillez saisir au moins un montant alloué à une facture.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await callEdgeFunction("record-payment", {
        schoolId: currentSchoolId,
        schoolYearId,
        studentId,
        amount: totalAllocated,
        currency: "XOF",
        paymentMethod,
        reference: reference || null,
        paymentDate,
        idempotencyKey,
        allocations: allocationList,
      });
      navigate("/payments", { replace: true });
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Enregistrer un paiement</h1>

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

      {openInvoices.length > 0 && (
        <div className="card">
          <h2>Allocation aux factures ouvertes</h2>
          {openInvoices.map((inv) => (
            <label key={inv.id} className="allocation-row">
              {inv.invoiceNumber} — solde {formatAmount(inv.balance)}
              <input
                type="number"
                min={0}
                max={inv.balance}
                step="0.01"
                value={allocations[inv.id] ?? ""}
                onChange={(e) => setAllocations((prev) => ({ ...prev, [inv.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}

      <label>
        Moyen de paiement
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>
          <option value="cash">Espèces</option>
          <option value="mobile_money">Mobile Money</option>
          <option value="bank_transfer">Virement bancaire</option>
          <option value="cheque">Chèque</option>
          <option value="other">Autre</option>
        </select>
      </label>

      <label>
        Référence (optionnel)
        <input value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>

      <label>
        Date de paiement
        <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
      </label>

      <p>
        <strong>Total à enregistrer : {formatAmount(totalAllocated)}</strong>
      </p>

      {error && <p className="error-text">{error}</p>}

      <button onClick={handleSubmit} disabled={submitting || totalAllocated <= 0}>
        {submitting ? "Enregistrement…" : "Enregistrer (en attente de confirmation)"}
      </button>
    </div>
  );
}
