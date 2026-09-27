// Toute erreur renvoyée au client doit être générique : jamais de stack
// trace, de détail SQL ou d'information interne Supabase. Le détail réel
// (si fourni) est uniquement journalisé côté serveur (console.error, capté
// par les logs Supabase Edge Functions).
export class AppError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, publicMessage: string, details?: unknown) {
    super(publicMessage);
    this.status = status;
    this.details = details;
  }
}

export function errorResponse(err: unknown, headers: Record<string, string>): Response {
  if (err instanceof AppError) {
    if (err.details) {
      console.error(`[AppError ${err.status}] ${err.message}`, err.details);
    } else {
      console.error(`[AppError ${err.status}] ${err.message}`);
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  console.error("[UnexpectedError]", err);
  return new Response(JSON.stringify({ error: "Une erreur interne est survenue." }), {
    status: 500,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
