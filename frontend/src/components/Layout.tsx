import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../app/AuthContext";

const STAFF_NAV = [
  { to: "/dashboard", label: "Tableau de bord", roles: ["director", "accountant"] },
  { to: "/students", label: "Élèves", roles: ["director", "accountant", "admin_staff"] },
  { to: "/guardians", label: "Responsables", roles: ["director", "accountant", "admin_staff"] },
  { to: "/invoices", label: "Factures", roles: ["director", "accountant"] },
  { to: "/unpaid", label: "Impayés", roles: ["director", "accountant"] },
  { to: "/payments", label: "Paiements", roles: ["director", "accountant"] },
  { to: "/refunds", label: "Remboursements", roles: ["director", "accountant"] },
  { to: "/receipts", label: "Reçus", roles: ["director", "accountant"] },
  { to: "/reports", label: "Rapports", roles: ["director"] },
  { to: "/settings", label: "Paramètres", roles: ["director"] },
];

export function Layout() {
  const { currentRole, memberships, currentSchoolId, setCurrentSchoolId, signOut, isSuperAdmin } = useAuth();

  const visibleNav = STAFF_NAV.filter((item) => !currentRole || item.roles.includes(currentRole));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-title">Frais Scolaires</div>
        {memberships.length > 1 && (
          <select
            value={currentSchoolId ?? ""}
            onChange={(e) => setCurrentSchoolId(e.target.value)}
            aria-label="École courante"
          >
            {memberships.map((m) => (
              <option key={m.schoolId} value={m.schoolId}>
                {m.school.name}
              </option>
            ))}
          </select>
        )}
        {isSuperAdmin && (
          <NavLink to="/admin/schools" className="link-button">
            Statistiques plateforme
          </NavLink>
        )}
        <NavLink to="/profile" className="link-button">
          Profil
        </NavLink>
        <button onClick={() => signOut()} className="link-button">
          Déconnexion
        </button>
      </header>

      <main className="app-content">
        <Outlet />
      </main>

      <nav className="app-bottom-nav">
        {visibleNav.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
