// Adaptateur WhatsApp Business Platform (Meta Cloud API). Implémentation
// réelle mais inerte tant que WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID
// ne sont pas configurés côté secrets Edge Functions (voir
// docs/ARCHITECTURE.md §12). N'utilise que des templates pré-approuvés
// (aucun message libre), conformément aux règles de la plateforme.

export interface WhatsAppSendResult {
  providerMessageId?: string;
}

export async function sendWhatsAppTemplate(opts: {
  to: string; // format E.164, ex: +22990000000
  templateName: string;
  languageCode?: string;
  bodyParameters: string[];
}): Promise<WhatsAppSendResult> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!token || !phoneNumberId) {
    throw new Error("Canal WhatsApp non configuré (secrets manquants) : envoi bloqué.");
  }

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: opts.to,
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.languageCode ?? "fr" },
        components: [
          {
            type: "body",
            parameters: opts.bodyParameters.map((text) => ({ type: "text", text })),
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Échec envoi WhatsApp (HTTP ${res.status}): ${body}`);
  }

  const json = await res.json();
  return { providerMessageId: json?.messages?.[0]?.id };
}
