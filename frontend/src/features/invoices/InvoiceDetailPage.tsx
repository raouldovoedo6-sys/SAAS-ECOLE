import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../services/supabase/client";
import { callEdgeFunction, EdgeFunctionError } from "../../services/edge-functions/client";
import { formatAmount, formatDate } from "../../lib/format";
import { useAuth } from "../../app/AuthContext";

interface Item {
  id: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  issued: "Émise",
  partially_paid: "Partiellement payée",
  paid: "Payée",
  overdue: "En retard",
  cancelled: "Annulée",
};

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { currentSchoolId } = useAuth();
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState<{
    invoiceNumber: string;
    issueDate: string;
    dueDate: string;
    status: string;
    totalAmount: number;
    paidAmount: number;
    currency: string;
    studentName: string;
  } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!id) return;
    const { data } = await supabase
      .from("invoices")
      .select("invoice_number, issue_date, due_date, status, total_amount, paid_amount, currency, students(first_name, last_name)")
      .eq("id", id)
      .single();
    if (data) {
      const student = Array.isArray(data.students) ? data.students[0] : data.students;
      setInvoice({
        invoiceNumber: data.invoice_number,
        issueDate: data.issue_date,
        dueDate: data.due_date,
        status: data.status,
        totalAmount: data.total_amount,
        paidAmount: data.paid_amount,
        currency: data.currency,
        studentName: student ? `${student.first_name} ${student.last_name}` : "",
      });
    }

    const { data: itemRows } = await supabase
      .from("invoice_items")
      .select("id, description, quantity, unit_amount, amount")
      .eq("invoice_id", id);
    setItems(
      (itemRows ?? []).map((i) => ({
        id: i.id,
        description: i.description,
        quantity: i.quantity,
        unitAmount: i.unit_amount,
        amount: i.amount,
      })),
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleCancel() {
    if (!currentSchoolId || !id) return;
    const reason = window.prompt("Motif de l'annulation :");
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await callEdgeFunction("cancel-invoice", { schoolId: currentSchoolId, invoiceId: id, reason });
      navigate("/invoices", { replace: true });
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!invoice) return <p>Chargement…</p>;

  return (
    <div>
      <h1>Facture {invoice.invoiceNumber}</h1>
      <p>
        Élève : <strong>{invoice.studentName}</strong>
      </p>
      <p>
        Émission : {formatDate(invoice.issueDate)} — Échéance : {formatDate(invoice.dueDate)} — Statut :{" "}
        <span className={`badge badge-${invoice.status}`}>{STATUS_LABELS[invoice.status] ?? invoice.status}</span>
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qté</th>
            <th>PU</th>
            <th>Montant</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.description}</td>
              <td>{item.quantity}</td>
              <td>{formatAmount(item.unitAmount, invoice.currency)}</td>
              <td>{formatAmount(item.amount, invoice.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        <strong>Total : {formatAmount(invoice.totalAmount, invoice.currency)}</strong> — Payé :{" "}
        {formatAmount(invoice.paidAmount, invoice.currency)} — Solde :{" "}
        {formatAmount(invoice.totalAmount - invoice.paidAmount, invoice.currency)}
      </p>

      {error && <p className="error-text">{error}</p>}

      {invoice.status !== "cancelled" && invoice.paidAmount === 0 && (
        <button onClick={handleCancel} disabled={submitting}>
          Annuler la facture
        </button>
      )}
      {invoice.paidAmount > 0 && invoice.status !== "cancelled" && (
        <p className="muted">
          Cette facture a déjà reçu des paiements confirmés : elle ne peut plus être annulée (utiliser un
          remboursement si nécessaire).
        </p>
      )}
    </div>
  );
}
