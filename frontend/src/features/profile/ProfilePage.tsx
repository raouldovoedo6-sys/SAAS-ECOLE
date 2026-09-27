import { useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";

// Utile en particulier après une invitation (mot de passe temporaire
// communiqué hors application, voir Paramètres → Utilisateurs) : la
// personne doit le changer dès sa première connexion.
export function ProfilePage() {
  const { user, memberships } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleChangePassword() {
    setError(null);
    setMessage(null);
    if (newPassword.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSubmitting(false);
    if (updateError) {
      setError("Impossible de changer le mot de passe.");
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setMessage("Mot de passe mis à jour.");
  }

  return (
    <div>
      <h1>Mon profil</h1>
      <p>Email : {user?.email}</p>
      <p>
        Écoles rattachées :{" "}
        {memberships.map((m) => `${m.school.name} (${m.role})`).join(", ") || "aucune"}
      </p>

      <div className="card">
        <h2>Changer mon mot de passe</h2>
        <label>
          Nouveau mot de passe
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <label>
          Confirmer le mot de passe
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        {message && <p>{message}</p>}
        <button onClick={handleChangePassword} disabled={submitting || !newPassword}>
          {submitting ? "Mise à jour…" : "Changer le mot de passe"}
        </button>
      </div>
    </div>
  );
}
