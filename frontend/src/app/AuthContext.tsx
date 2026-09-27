import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase/client";
import type { SchoolMembership, SchoolRole } from "../types/domain";

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  memberships: SchoolMembership[];
  currentSchoolId: string | null;
  currentRole: SchoolRole | null;
  isSuperAdmin: boolean;
  setCurrentSchoolId: (schoolId: string) => void;
  refreshMemberships: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// IMPORTANT : "currentSchoolId" et le rôle affiché ici ne servent qu'à
// l'expérience utilisateur (masquer/afficher des écrans, filtrer des
// requêtes). Ce n'est PAS une protection de sécurité — celle-ci est
// entièrement assurée par les policies RLS PostgreSQL et les Edge
// Functions, qui revérifient l'appartenance et le rôle réels à chaque
// requête (voir docs/ARCHITECTURE.md §4).
export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<SchoolMembership[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [currentSchoolId, setCurrentSchoolIdState] = useState<string | null>(
    () => localStorage.getItem("currentSchoolId"),
  );

  async function loadSuperAdminStatus(userId: string) {
    // La policy RLS platform_admins_select ne renvoie une ligne que si
    // l'utilisateur est réellement super admin : ce test est fiable côté
    // affichage, mais chaque action sensible reste revalidée côté serveur.
    const { data } = await supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
    setIsSuperAdmin(!!data);
  }

  async function loadMemberships(userId: string) {
    const { data, error } = await supabase
      .from("school_users")
      .select("school_id, role, permissions, schools(id, name, slug, currency, status)")
      .eq("user_id", userId)
      .eq("status", "active");

    if (error) {
      console.error("Erreur de chargement des écoles rattachées", error);
      setMemberships([]);
      return;
    }

    const parsed: SchoolMembership[] = (data ?? []).map((row) => {
      const school = Array.isArray(row.schools) ? row.schools[0] : row.schools;
      return {
        schoolId: row.school_id,
        role: row.role as SchoolRole,
        permissions: (row.permissions as Record<string, boolean>) ?? {},
        school: {
          id: school?.id ?? row.school_id,
          name: school?.name ?? "École",
          slug: school?.slug ?? "",
          currency: school?.currency ?? "XOF",
          status: school?.status ?? "active",
        },
      };
    });

    setMemberships(parsed);
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        await Promise.all([loadMemberships(data.session.user.id), loadSuperAdminStatus(data.session.user.id)]);
      }
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        await Promise.all([loadMemberships(newSession.user.id), loadSuperAdminStatus(newSession.user.id)]);
      } else {
        setMemberships([]);
        setIsSuperAdmin(false);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (currentSchoolId) {
      localStorage.setItem("currentSchoolId", currentSchoolId);
    }
  }, [currentSchoolId]);

  // Si l'école courante n'est plus dans la liste des rattachements (ex :
  // rôle révoqué), on retombe sur la première disponible.
  useEffect(() => {
    if (memberships.length === 0) return;
    const stillValid = memberships.some((m) => m.schoolId === currentSchoolId);
    if (!stillValid) {
      setCurrentSchoolIdState(memberships[0].schoolId);
    }
  }, [memberships, currentSchoolId]);

  const currentRole = useMemo(
    () => memberships.find((m) => m.schoolId === currentSchoolId)?.role ?? null,
    [memberships, currentSchoolId],
  );

  const value: AuthContextValue = {
    loading,
    session,
    user: session?.user ?? null,
    memberships,
    currentSchoolId,
    currentRole,
    isSuperAdmin,
    setCurrentSchoolId: setCurrentSchoolIdState,
    refreshMemberships: async () => {
      if (session?.user) await loadMemberships(session.user.id);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans un AuthProvider.");
  return ctx;
}
