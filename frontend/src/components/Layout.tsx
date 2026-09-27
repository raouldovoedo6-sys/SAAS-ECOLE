import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  GraduationCap,
  Users,
  FileText,
  AlertTriangle,
  Wallet,
  RotateCcw,
  Receipt,
  BarChart3,
  Settings,
  Building2,
  UserCircle,
  LogOut,
  School,
} from "lucide-react";
import { useAuth } from "../app/AuthContext";
import type { SchoolRole } from "../types/domain";

const STAFF_NAV: { to: string; label: string; roles: SchoolRole[]; icon: typeof LayoutDashboard }[] = [
  { to: "/dashboard", label: "Tableau de bord", roles: ["director", "accountant"], icon: LayoutDashboard },
  { to: "/students", label: "Élèves", roles: ["director", "accountant", "admin_staff"], icon: GraduationCap },
  { to: "/guardians", label: "Responsables", roles: ["director", "accountant", "admin_staff"], icon: Users },
  { to: "/invoices", label: "Factures", roles: ["director", "accountant"], icon: FileText },
  { to: "/unpaid", label: "Impayés", roles: ["director", "accountant"], icon: AlertTriangle },
  { to: "/payments", label: "Paiements", roles: ["director", "accountant"], icon: Wallet },
  { to: "/refunds", label: "Remboursements", roles: ["director", "accountant"], icon: RotateCcw },
  { to: "/receipts", label: "Reçus", roles: ["director", "accountant"], icon: Receipt },
  { to: "/reports", label: "Rapports", roles: ["director"], icon: BarChart3 },
  { to: "/settings", label: "Paramètres", roles: ["director"], icon: Settings },
];

export function Layout() {
  const { currentRole, memberships, currentSchoolId, setCurrentSchoolId, signOut, isSuperAdmin, user } = useAuth();

  const visibleNav = STAFF_NAV.filter((item) => !currentRole || item.roles.includes(currentRole));
  const currentSchoolName = memberships.find((m) => m.schoolId === currentSchoolId)?.school.name;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-icon">
            <School size={18} color="#fff" />
          </span>
          School Manage
        </div>

        <nav className="sidebar-nav">
          {visibleNav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          {isSuperAdmin && (
            <NavLink to="/admin/schools" className={({ isActive }) => (isActive ? "active" : "")}>
              <Building2 size={18} />
              Statistiques plateforme
            </NavLink>
          )}
          <NavLink to="/profile" className={({ isActive }) => (isActive ? "active" : "")}>
            <UserCircle size={18} />
            Profil
          </NavLink>
          <button onClick={() => signOut()} className="link-button">
            <LogOut size={18} />
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-title">
            Bienvenue{user?.email ? `, ${user.email.split("@")[0]}` : ""} 👋
            {currentSchoolName && <span>{currentSchoolName}</span>}
          </div>
          <div className="app-topbar-actions">
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
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>

      <nav className="app-bottom-nav">
        {visibleNav.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
