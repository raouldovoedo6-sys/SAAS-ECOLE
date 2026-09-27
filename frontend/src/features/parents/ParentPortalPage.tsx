import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { openSignedDocument } from "../../lib/documents";
import { formatAmount, formatDate } from "../../lib/format";
import type { Student } from "../../types/domain";

interface ChildInvoice {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
}

interface ChildReceipt {
  id: string;
  receiptNumber: string;
  issuedAt: string;
}

// Toutes les requêtes ci-dessous ne filtrent PAS explicitement "mes
// enfants" : c'est la policy RLS (guardian_student_ids) qui restreint déjà
// les résultats aux seuls élèves dont ce parent est responsable autorisé.
// Aucune vérification côté client n'est nécessaire ni suffisante ici.
export function ParentPortalPage() {
  const { currentSchoolId } = useAuth();
  const [children, setChildren] = useState<Student[]>([]);
  const [invoicesByChild, setInvoicesByChild] = useState<Record<string, ChildInvoice[]>>({});
  const [receiptsByChild, setReceiptsByChild] = useState<Record<string, ChildReceipt[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data: studentRows } = await supabase
        .from("students")
        .select("id, school_id, student_code, first_name, last_name, status")
        .eq("school_id", currentSchoolId);

      const kids: Student[] = (studentRows ?? []).map((s) => ({
        id: s.id,
        schoolId: s.school_id,
        studentCode: s.student_code,
        firstName: s.first_name,
        lastName: s.last_name,
        status: s.status,
      }));
      if (cancelled) return;
      setChildren(kids);

      const invoiceMap: Record<string, ChildInvoice[]> = {};
      const receiptMap: Record<string, ChildReceipt[]> = {};

      for (const kid of kids) {
        const { data: invoiceRows } = await supabase
          .from("invoices")
          .select("id, invoice_number, due_date, total_amount, paid_amount, status")
          .eq("student_id", kid.id)
          .order("due_date", { ascending: false });
        invoiceMap[kid.id] = (invoiceRows ?? []).map((i) => ({
          id: i.id,
          invoiceNumber: i.invoice_number,
          dueDate: i.due_date,
          totalAmount: i.total_amount,
          paidAmount: i.paid_amount,
          status: i.status,
        }));

        const { data: receiptRows } = await supabase
          .from("receipts")
          .select("id, receipt_number, issued_at, payment:payments!inner(student_id)")
          .eq("payment.student_id", kid.id)
          .order("issued_at", { ascending: false });
        receiptMap[kid.id] = (receiptRows ?? []).map((r) => ({
          id: r.id,
          receiptNumber: r.receipt_number,
          issuedAt: r.issued_at,
        }));
      }

      if (!cancelled) {
        setInvoicesByChild(invoiceMap);
        setReceiptsByChild(receiptMap);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentSchoolId]);

  async function handleDownloadReceipt(receiptId: string) {
    if (!currentSchoolId) return;
    await openSignedDocument(currentSchoolId, "receipt", receiptId);
  }

  if (loading) return <p>Chargement…</p>;

  return (
    <div>
      <h1>Mes enfants</h1>
      {children.length === 0 && <p className="muted">Aucun enfant rattaché à votre compte pour cette école.</p>}

      {children.map((kid) => {
        const invoices = invoicesByChild[kid.id] ?? [];
        const receipts = receiptsByChild[kid.id] ?? [];
        const totalDue = invoices.reduce((s, i) => s + i.totalAmount, 0);
        const totalPaid = invoices.reduce((s, i) => s + i.paidAmount, 0);

        return (
          <section key={kid.id} className="card">
            <h2>
              {kid.firstName} {kid.lastName} <span className="muted">({kid.studentCode})</span>
            </h2>
            <p>
              Montant dû : <strong>{formatAmount(totalDue)}</strong> — Montant payé :{" "}
              <strong>{formatAmount(totalPaid)}</strong> — Solde restant :{" "}
              <strong>{formatAmount(totalDue - totalPaid)}</strong>
            </p>

            <h3>Factures</h3>
            <ul className="list">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  {inv.invoiceNumber} — échéance {formatDate(inv.dueDate)} — solde{" "}
                  {formatAmount(inv.totalAmount - inv.paidAmount)} ({inv.status})
                </li>
              ))}
              {invoices.length === 0 && <li className="muted">Aucune facture.</li>}
            </ul>

            <h3>Reçus</h3>
            <ul className="list">
              {receipts.map((r) => (
                <li key={r.id}>
                  {r.receiptNumber} — {formatDate(r.issuedAt)}{" "}
                  <button onClick={() => handleDownloadReceipt(r.id)}>Télécharger</button>
                </li>
              ))}
              {receipts.length === 0 && <li className="muted">Aucun reçu.</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
