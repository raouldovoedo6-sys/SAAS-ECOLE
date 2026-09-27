import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { callEdgeFunction, EdgeFunctionError } from "../../services/edge-functions/client";
import { formatAmount, formatDate } from "../../lib/format";

interface RefundRow {
  id: string;
  paymentId: string;
  paymentNumber: string;
  amount: number;
  reason: string;
  status: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  approved: "Approuvé",
  rejected: "Rejeté",
  completed: "Remboursé",
};

export function RefundsPage() {
  const { currentSchoolId, currentRole } = useAuth();
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [paymentNumber, setPaymentNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    if (!currentSchoolId) return;
    const { data } = await supabase
      .from("refunds")
      .select("id, payment_id, amount, reason, status, created_at, payments(payment_number)")
      .eq("school_id", currentSchoolId)
      .order("created_at", { ascending: false });
    setRefunds(
      (data ?? []).map((r) => {
        const payment = Array.isArray(r.payments) ? r.payments[0] : r.payments;
        return {
          id: r.id,
          paymentId: r.payment_id,
          paymentNumber: payment?.payment_number ?? "",
          amount: r.amount,
          reason: r.reason,
          status: r.status,
          createdAt: r.created_at,
        };
      }),
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId]);

  async function handleRequest() {
    if (!currentSchoolId || !paymentNumber || !amount || !reason) return;
    setError(null);

    const { data: payment } = await supabase
      .from("payments")
      .select("id")
      .eq("school_id", currentSchoolId)
      .eq("payment_number", paymentNumber.trim())
      .maybeSingle();

    if (!payment) {
      setError("Aucun paiement trouvé avec ce numéro.");
      return;
    }

    try {
      await callEdgeFunction("request-refund", {
        schoolId: currentSchoolId,
        paymentId: payment.id,
        amount: parseFloat(amount),
        reason,
      });
      setPaymentNumber("");
      setAmount("");
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    }
  }

  async function decide(refundId: string, decision: "approved" | "rejected") {
    if (!currentSchoolId) return;
    setBusyId(refundId);
    setError(null);
    try {
      await callEdgeFunction("approve-refund", { schoolId: currentSchoolId, refundId, decision });
      await load();
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1>Remboursements</h1>

      <div className="card">
        <h2>Nouvelle demande</h2>
        <label>
          Numéro de paiement (ex : PAY-2026-000012)
          <input value={paymentNumber} onChange={(e) => setPaymentNumber(e.target.value)} />
        </label>
        <label>
          Montant à rembourser
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Motif
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button onClick={handleRequest} disabled={!paymentNumber || !amount || !reason}>
          Demander
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Paiement</th>
            <th>Montant</th>
            <th>Motif</th>
            <th>Date</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {refunds.map((r) => (
            <tr key={r.id}>
              <td>{r.paymentNumber}</td>
              <td>{formatAmount(r.amount)}</td>
              <td>{r.reason}</td>
              <td>{formatDate(r.createdAt)}</td>
              <td>
                <span className={`badge badge-${r.status}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
              </td>
              <td>
                {r.status === "pending" && currentRole === "director" && (
                  <>
                    <button disabled={busyId === r.id} onClick={() => decide(r.id, "approved")}>
                      Approuver
                    </button>
                    <button disabled={busyId === r.id} onClick={() => decide(r.id, "rejected")}>
                      Rejeter
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {refunds.length === 0 && <p className="muted">Aucune demande de remboursement.</p>}
    </div>
  );
}
