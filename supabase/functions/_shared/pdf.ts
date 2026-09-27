import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// Génération de PDF entièrement côté serveur : la mise en page est
// construite à partir des données rechargées depuis la base au moment de
// l'appel, jamais depuis un payload client (voir docs/ARCHITECTURE.md §7,
// §13). pdf-lib est un choix pur JS, sans navigateur headless, adapté aux
// contraintes de démarrage rapide d'une Edge Function Deno.

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const LEFT = 50;

interface Line {
  text: string;
  size?: number;
  bold?: boolean;
  color?: [number, number, number];
  gapAfter?: number;
}

async function renderLines(title: string, lines: Line[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - 60;
  page.drawText(title, { x: LEFT, y, size: 16, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 30;

  for (const line of lines) {
    const size = line.size ?? 11;
    page.drawText(line.text, {
      x: LEFT,
      y,
      size,
      font: line.bold ? bold : font,
      color: rgb(...(line.color ?? [0.1, 0.1, 0.1])),
    });
    y -= size + (line.gapAfter ?? 8);
  }

  return doc.save();
}

export interface ReceiptPdfData {
  schoolName: string;
  receiptNumber: string;
  issuedAtLabel: string;
  studentFullName: string;
  studentCode: string;
  amount: number;
  currency: string;
  paymentMethodLabel: string;
  reference?: string | null;
  totalDue: number;
  paidToDate: number;
  balanceAfter: number;
  issuedByName?: string | null;
}

export function generateReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const fmt = (n: number) => `${n.toLocaleString("fr-FR")} ${data.currency}`;
  return renderLines(`${data.schoolName} — Reçu de paiement`, [
    { text: `N° reçu : ${data.receiptNumber}`, bold: true },
    { text: `Date d'émission : ${data.issuedAtLabel}` },
    { text: " ", size: 4 },
    { text: `Élève : ${data.studentFullName} (${data.studentCode})` },
    { text: " ", size: 4 },
    { text: `Montant encaissé : ${fmt(data.amount)}`, size: 13, bold: true },
    { text: `Mode de paiement : ${data.paymentMethodLabel}` },
    ...(data.reference ? [{ text: `Référence : ${data.reference}` }] : []),
    { text: " ", size: 4 },
    { text: `Total payé à ce jour : ${fmt(data.paidToDate)}` },
    { text: `Montant total dû : ${fmt(data.totalDue)}` },
    { text: `Solde restant après ce paiement : ${fmt(data.balanceAfter)}`, bold: true },
    ...(data.issuedByName ? [{ text: `Agent : ${data.issuedByName}`, size: 9, gapAfter: 4 }] : []),
    { text: " ", size: 10 },
    {
      text: "Ce reçu est généré automatiquement après confirmation du paiement par l'établissement.",
      size: 8,
      color: [0.4, 0.4, 0.4],
    },
  ]);
}

export interface InvoicePdfData {
  schoolName: string;
  invoiceNumber: string;
  issueDateLabel: string;
  dueDateLabel: string;
  studentFullName: string;
  studentCode: string;
  guardianName?: string | null;
  items: { description: string; amount: number }[];
  totalAmount: number;
  paidAmount: number;
  currency: string;
  statusLabel: string;
}

export function generateInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const fmt = (n: number) => `${n.toLocaleString("fr-FR")} ${data.currency}`;
  const itemLines: Line[] = data.items.map((it) => ({
    text: `  • ${it.description} — ${fmt(it.amount)}`,
    size: 10,
  }));

  return renderLines(`${data.schoolName} — Facture`, [
    { text: `N° facture : ${data.invoiceNumber}`, bold: true },
    { text: `Date d'émission : ${data.issueDateLabel}` },
    { text: `Échéance : ${data.dueDateLabel}` },
    { text: `Statut : ${data.statusLabel}` },
    { text: " ", size: 4 },
    { text: `Élève : ${data.studentFullName} (${data.studentCode})` },
    ...(data.guardianName ? [{ text: `Responsable : ${data.guardianName}` }] : []),
    { text: " ", size: 6 },
    { text: "Détail :", bold: true },
    ...itemLines,
    { text: " ", size: 6 },
    { text: `Montant total : ${fmt(data.totalAmount)}`, bold: true },
    { text: `Déjà payé : ${fmt(data.paidAmount)}` },
    { text: `Solde restant : ${fmt(data.totalAmount - data.paidAmount)}`, bold: true },
  ]);
}
