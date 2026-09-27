import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import type { SchoolRole } from "../types/domain";

// Masque un écran pour l'expérience utilisateur uniquement. La véritable
// protection est assurée côté serveur (RLS + Edge Functions) : ce garde ne
// fait qu'éviter d'afficher un écran inutile à un rôle qui n'y a pas droit.
export function RequireRole({ allowed, children }: { allowed: SchoolRole[]; children: ReactNode }) {
  const { currentRole } = useAuth();

  if (!currentRole || !allowed.includes(currentRole)) {
    return (
      <div className="card">
        <p>Accès non disponible pour votre rôle actuel.</p>
      </div>
    );
  }

  return <>{children}</>;
}
