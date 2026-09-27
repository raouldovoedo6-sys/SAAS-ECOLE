import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { callEdgeFunction, EdgeFunctionError } from "../../services/edge-functions/client";
import { formatAmount, formatDate } from "../../lib/format";
import type { Payment } from "../../types/domain";

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  confirmed: "Confirmé",
  rejected: "Rejeté",
  cancelled: "Annulé",
};

export function PaymentsListPage() {
  const { currentSchoolId } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!currentSchoolId) return;
    setLoading(true);
    const { data } = await supabase
      .from("payments")
      .select("id, school_id, student_id, payment_number, amount, currency, payment_method, reference, payment_date, status")
      .eq("school_id", currentSchoolId)
      .order("created_at", { ascending: false });

    setPayments(
      (data ?? []).map((p) => ({
        id: p.id,
        schoolId: p.school_id,
        studentId: p.student_id,
        paymentNumber: p.payment_number,
        amount: p.amount,
        currency: p.currency,
        paymentMethod: p.payment_method,
        reference: p.reference,
        paymentDate: p.payment_date,
        status: p.status,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId]);

  async function confirm(paymentId: string) {
    if (!currentSchoolId) return;
    setBusyId(paymentId);
    setError(null);
    try {
      await callEdgeFunction("confirm-payment", { schoolId: currentSchoolId, paymentId });
      await load();
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(paymentId: string) {
    if (!currentSchoolId) return;
    const reason = window.prompt("Motif du rejet :");
    if (!reason) return;
    setBusyId(paymentId);
    setError(null);
    try {
      await callEdgeFunction("reject-payment", { schoolId: currentSchoolId, paymentId, reason });
      await load();
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Paiements</h1>
        <Link to="/payments/new" className="button">
          + Enregistrer un paiement
        </Link>
      </div>

      {loading && <p>Chargement…</p>}
      {error && <p className="error-text">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Date</th>
            <th>Montant</th>
            <th>Moyen</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{p.paymentNumber}</td>
              <td>{formatDate(p.paymentDate)}</td>
              <td>{formatAmount(p.amount, p.currency)}</td>
              <td>{p.paymentMethod}</td>
              <td>
                <span className={`badge badge-${p.status}`}>{STATUS_LABELS[p.status] ?? p.status}</span>
              </td>
              <td>
                {p.status === "pending" && (
                  <>
                    <button disabled={busyId === p.id} onClick={() => confirm(p.id)}>
                      Confirmer
                    </button>
                    <button disabled={busyId === p.id} onClick={() => reject(p.id)}>
                      Rejeter
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && payments.length === 0 && <p className="muted">Aucun paiement.</p>}
    </div>
  );
}
