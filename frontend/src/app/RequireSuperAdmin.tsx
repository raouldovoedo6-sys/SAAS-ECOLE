import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";

// Comme RequireRole : masque l'écran pour l'UX. La protection réelle est
// la policy RLS platform_admins_select / is_super_admin() côté serveur.
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { isSuperAdmin } = useAuth();

  if (!isSuperAdmin) {
    return (
      <div className="card">
        <p>Accès réservé au super administrateur de la plateforme.</p>
      </div>
    );
  }

  return <>{children}</>;
}
