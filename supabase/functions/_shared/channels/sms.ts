// Adaptateur SMS générique. Aucun fournisseur n'est encore choisi (voir
// docs/ARCHITECTURE.md, points à clarifier). Tant que les secrets ne sont
// pas configurés, le canal est inerte : aucun appel réseau n'est fait,
// même si notification_channel_settings.enabled venait à être mal
// configuré à true par erreur (double garde-fou).
//
// Pour brancher un fournisseur (Africa's Talking, Twilio, Infobip...) :
// implémenter l'appel HTTP ici, garder la signature `sendSms` inchangée.

export interface SmsSendResult {
  providerMessageId?: string;
}

export async function sendSms(opts: {
  to: string;
  message: string;
}): Promise<SmsSendResult> {
  const apiKey = Deno.env.get("SMS_PROVIDER_API_KEY");
  const senderId = Deno.env.get("SMS_SENDER_ID");

  if (!apiKey || !senderId) {
    throw new Error("Canal SMS non configuré (secrets manquants) : envoi bloqué.");
  }

  // TODO(implémentation fournisseur) : remplacer par l'appel HTTP réel une
  // fois le fournisseur SMS choisi et ses identifiants disponibles.
  throw new Error("Fournisseur SMS non encore implémenté.");
}
