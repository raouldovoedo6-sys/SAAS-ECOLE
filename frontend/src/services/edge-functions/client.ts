import { supabase } from "../supabase/client";

export class EdgeFunctionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Appelle une Edge Function en transmettant le JWT de la session courante.
// Le frontend ne fait AUCUNE vérification de rôle/permission ici : il ne
// fait qu'appeler la fonction, qui revalide tout côté serveur. Un rejet
// (403/400) doit être traité comme faisant autorité, jamais contourné côté
// client.
export async function callEdgeFunction<TResponse>(
  name: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke<TResponse>(name, { body });

  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status ?? 500;
    let message = "Une erreur est survenue.";
    try {
      const context = (error as { context?: Response }).context;
      if (context && "json" in context) {
        const parsed = await (context as Response).clone().json();
        if (parsed?.error) message = parsed.error;
      }
    } catch {
      // ignore : on garde le message générique
    }
    throw new EdgeFunctionError(status, message);
  }

  return data as TResponse;
}
