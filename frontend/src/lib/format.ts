export function formatAmount(amount: number, currency = "XOF"): string {
  return `${amount.toLocaleString("fr-FR")} ${currency}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR");
}
