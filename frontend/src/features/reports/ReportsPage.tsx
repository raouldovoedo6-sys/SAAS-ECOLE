import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { formatAmount, formatDate } from "../../lib/format";

interface ReportRow {
  invoiceNumber: string;
  studentName: string;
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
}

function toCsv(rows: ReportRow[]): string {
  const header = ["Facture", "Élève", "Émission", "Échéance", "Total", "Payé", "Solde", "Statut"];
  const lines = rows.map((r) =>
    [
      r.invoiceNumber,
      r.studentName,
      r.issueDate,
      r.dueDate,
      r.totalAmount,
      r.paidAmount,
      r.totalAmount - r.paidAmount,
      r.status,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(";"),
  );
  return [header.join(";"), ...lines].join("\n");
}

export function ReportsPage() {
  const { currentSchoolId } = useAuth();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      let query = supabase
        .from("invoices")
        .select("invoice_number, issue_date, due_date, total_amount, paid_amount, status, students(first_name, last_name)")
        .eq("school_id", currentSchoolId)
        .order("issue_date", { ascending: false });

      if (periodStart) query = query.gte("issue_date", periodStart);
      if (periodEnd) query = query.lte("issue_date", periodEnd);

      const { data } = await query;
      if (cancelled) return;

      setRows(
        (data ?? []).map((i) => {
          const student = Array.isArray(i.students) ? i.students[0] : i.students;
          return {
            invoiceNumber: i.invoice_number,
            studentName: student ? `${student.first_name} ${student.last_name}` : "",
            issueDate: i.issue_date,
            dueDate: i.due_date,
            totalAmount: i.total_amount,
            paidAmount: i.paid_amount,
            status: i.status,
          };
        }),
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentSchoolId, periodStart, periodEnd]);

  const totalInvoiced = rows.reduce((s, r) => s + r.totalAmount, 0);
  const totalCollected = rows.reduce((s, r) => s + r.paidAmount, 0);

  function handleExport() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport-factures-${periodStart || "debut"}-${periodEnd || "fin"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1>Rapports</h1>

      <div className="quarter-picker">
        <label>
          Du
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </label>
        <label>
          Au
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </label>
      </div>
      <p className="muted">Laisser vide pour le cumul complet depuis le début de l'historique.</p>

      <p>
        <strong>Total facturé : {formatAmount(totalInvoiced)}</strong> — Total recouvré :{" "}
        <strong>{formatAmount(totalCollected)}</strong>
      </p>

      <button onClick={handleExport} disabled={rows.length === 0}>
        Exporter en CSV
      </button>

      {loading && <p>Chargement…</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Facture</th>
            <th>Élève</th>
            <th>Émission</th>
            <th>Total</th>
            <th>Payé</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invoiceNumber}>
              <td>{r.invoiceNumber}</td>
              <td>{r.studentName}</td>
              <td>{formatDate(r.issueDate)}</td>
              <td>{formatAmount(r.totalAmount)}</td>
              <td>{formatAmount(r.paidAmount)}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
