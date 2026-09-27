import { callEdgeFunction } from "../services/edge-functions/client";

// Toute ouverture de facture/reçu passe par cette Edge Function, qui
// revalide l'autorisation côté serveur et émet une URL signée à courte
// durée de vie (jamais d'URL publique permanente — voir docs §13).
export async function openSignedDocument(
  schoolId: string,
  documentType: "invoice" | "receipt",
  documentId: string,
): Promise<void> {
  const result = await callEdgeFunction<{ url: string }>("generate-document-url", {
    schoolId,
    documentType,
    documentId,
  });
  window.open(result.url, "_blank", "noopener,noreferrer");
}
