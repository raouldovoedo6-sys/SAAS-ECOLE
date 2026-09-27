import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { callEdgeFunction, EdgeFunctionError } from "../../services/edge-functions/client";
import type { SchoolRole } from "../../types/domain";

interface MemberRow {
  userId: string;
  fullName: string;
  role: SchoolRole;
  status: string;
}

const ROLE_LABELS: Record<SchoolRole, string> = {
  director: "Directeur",
  accountant: "Comptable",
  admin_staff: "Personnel administratif",
  parent: "Parent (sans accès à l'application)",
};

// Sans fournisseur email, l'invitation ne peut pas envoyer de lien : un
// mot de passe temporaire est affiché UNE SEULE FOIS ici, à transmettre à
// la personne de façon sûre (elle devra le changer dès sa connexion, voir
// Mon profil).
export function UsersRolesPage() {
  const { currentSchoolId, user } = useAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<SchoolRole>("accountant");
  const [error, setError] = useState<string | null>(null);
  const [tempPasswordInfo, setTempPasswordInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!currentSchoolId) return;
    const { data } = await supabase
      .from("school_users")
      .select("user_id, role, status, app_users(full_name)")
      .eq("school_id", currentSchoolId);
    setMembers(
      (data ?? []).map((m) => {
        const profile = Array.isArray(m.app_users) ? m.app_users[0] : m.app_users;
        return { userId: m.user_id, fullName: profile?.full_name ?? "—", role: m.role, status: m.status };
      }),
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId]);

  async function handleInvite() {
    if (!currentSchoolId || !email || !fullName) return;
    setSubmitting(true);
    setError(null);
    setTempPasswordInfo(null);
    try {
      const result = await callEdgeFunction<{ accountCreated: boolean; temporaryPassword: string | null }>(
        "invite-school-user",
        { schoolId: currentSchoolId, email, fullName, role },
      );
      if (result.accountCreated && result.temporaryPassword) {
        setTempPasswordInfo(
          `Compte créé pour ${email}. Mot de passe temporaire à transmettre en toute sécurité : ${result.temporaryPassword}`,
        );
      }
      setEmail("");
      setFullName("");
      await load();
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(targetUserId: string, newRole: SchoolRole) {
    if (!currentSchoolId) return;
    setError(null);
    try {
      await callEdgeFunction("change-user-role", { schoolId: currentSchoolId, targetUserId, role: newRole });
      await load();
    } catch (err) {
      setError(err instanceof EdgeFunctionError ? err.message : "Erreur inattendue.");
    }
  }

  return (
    <div>
      <h1>Utilisateurs et rôles</h1>

      <table className="table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Rôle</th>
            <th>Statut</th>
            <th>Changer le rôle</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>{m.fullName}</td>
              <td>{ROLE_LABELS[m.role]}</td>
              <td>{m.status}</td>
              <td>
                {m.userId !== user?.id && (
                  <select value={m.role} onChange={(e) => handleRoleChange(m.userId, e.target.value as SchoolRole)}>
                    <option value="director">Directeur</option>
                    <option value="accountant">Comptable</option>
                    <option value="admin_staff">Personnel administratif</option>
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card">
        <h2>Inviter un utilisateur</h2>
        <label>
          Nom complet
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Rôle
          <select value={role} onChange={(e) => setRole(e.target.value as SchoolRole)}>
            <option value="director">Directeur</option>
            <option value="accountant">Comptable</option>
            <option value="admin_staff">Personnel administratif</option>
          </select>
        </label>

        {error && <p className="error-text">{error}</p>}
        {tempPasswordInfo && <p className="card">{tempPasswordInfo}</p>}

        <button onClick={handleInvite} disabled={submitting || !email || !fullName}>
          {submitting ? "Invitation…" : "Inviter"}
        </button>
      </div>
    </div>
  );
}
