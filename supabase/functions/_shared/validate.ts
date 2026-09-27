import type { ZodSchema } from "npm:zod@3";
import { AppError } from "./errors.ts";

export async function parseJsonBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError(400, "Corps de requête JSON invalide.");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, "Données invalides.", result.error.flatten());
  }
  return result.data;
}
