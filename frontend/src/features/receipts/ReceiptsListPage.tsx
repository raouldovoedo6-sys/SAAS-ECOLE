import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { openSignedDocument } from "../../lib/documents";
import { formatDate } from "../../lib/format";

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  issuedAt: string;
  voided: boolean;
}

export function ReceiptsListPage() {
  const { currentSchoolId } = useAuth();
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;

    supabase
      .from("receipts")
      .select("id, receipt_number, issued_at, voided")
      .eq("school_id", currentSchoolId)
      .order("issued_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setReceipts(
          (data ?? []).map((r) => ({
            id: r.id,
            receiptNumber: r.receipt_number,
            issuedAt: r.issued_at,
            voided: r.voided,
          })),
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentSchoolId]);

  async function handleDownload(id: string) {
    if (!currentSchoolId) return;
    setError(null);
    try {
      await openSignedDocument(currentSchoolId, "receipt", id);
    } catch {
      setError("Impossible d'ouvrir ce document.");
    }
  }

  return (
    <div>
      <h1>Reçus</h1>
      {loading && <p>Chargement…</p>}
      {error && <p className="error-text">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Date</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.id}>
              <td>{r.receiptNumber}</td>
              <td>{formatDate(r.issuedAt)}</td>
              <td>{r.voided ? "Annulé" : "Valide"}</td>
              <td>
                <button onClick={() => handleDownload(r.id)}>Télécharger</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && receipts.length === 0 && <p className="muted">Aucun reçu.</p>}
    </div>
  );
}
