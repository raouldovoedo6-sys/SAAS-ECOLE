import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { formatAmount, formatDate } from "../../lib/format";
import type { Invoice } from "../../types/domain";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  issued: "Émise",
  partially_paid: "Partiellement payée",
  paid: "Payée",
  overdue: "En retard",
  cancelled: "Annulée",
};

export function InvoicesListPage() {
  const { currentSchoolId } = useAuth();
  const [searchParams] = useSearchParams();
  const studentId = searchParams.get("studentId");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      let query = supabase
        .from("invoices")
        .select("id, school_id, student_id, invoice_number, issue_date, due_date, status, total_amount, paid_amount, currency")
        .eq("school_id", currentSchoolId)
        .order("issue_date", { ascending: false });

      if (studentId) query = query.eq("student_id", studentId);

      const { data } = await query;
      if (!cancelled) {
        setInvoices(
          (data ?? []).map((i) => ({
            id: i.id,
            schoolId: i.school_id,
            studentId: i.student_id,
            invoiceNumber: i.invoice_number,
            issueDate: i.issue_date,
            dueDate: i.due_date,
            status: i.status,
            totalAmount: i.total_amount,
            paidAmount: i.paid_amount,
            currency: i.currency,
          })),
        );
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentSchoolId, studentId]);

  return (
    <div>
      <div className="page-header">
        <h1>Factures</h1>
        <Link to={studentId ? `/invoices/new?studentId=${studentId}` : "/invoices/new"} className="button">
          + Nouvelle facture
        </Link>
      </div>

      {loading && <p>Chargement…</p>}

      <table className="table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Émission</th>
            <th>Échéance</th>
            <th>Statut</th>
            <th>Total</th>
            <th>Payé</th>
            <th>Solde</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td>{inv.invoiceNumber}</td>
              <td>{formatDate(inv.issueDate)}</td>
              <td>{formatDate(inv.dueDate)}</td>
              <td>
                <span className={`badge badge-${inv.status}`}>{STATUS_LABELS[inv.status] ?? inv.status}</span>
              </td>
              <td>{formatAmount(inv.totalAmount, inv.currency)}</td>
              <td>{formatAmount(inv.paidAmount, inv.currency)}</td>
              <td>{formatAmount(inv.totalAmount - inv.paidAmount, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && invoices.length === 0 && <p className="muted">Aucune facture.</p>}
    </div>
  );
}
