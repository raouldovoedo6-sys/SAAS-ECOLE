import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { School } from "lucide-react";
import { supabase } from "../../services/supabase/client";
import { callEdgeFunction, EdgeFunctionError } from "../../services/edge-functions/client";
import { useAuth } from "../../app/AuthContext";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Auto-inscription : un directeur crée directement son compte ET son école,
// sans passer par un super administrateur (celui-ci n'a qu'un rôle de
// supervision de la plateforme, voir SuperAdminDashboardPage).
export function SignUpPage() {
  const { session, refreshMemberships } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [schoolSlug, setSchoolSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Redirection automatique uniquement si une session existait déjà AVANT
  // toute tentative de soumission sur cette page (visite directe de /signup
  // par quelqu'un déjà connecté). Ne dépend jamais de "session" pendant le
  // flux de création : sinon un échec de register-school (réseau, slug déjà
  // pris...) redirigerait quand même vers /dashboard en masquant l'erreur,
  // puisque le compte auth existe déjà à ce stade même si l'école n'a pas
  // été créée.
  if (session && !accountReady && !submitting) return <Navigate to="/dashboard" replace />;

  function handleSchoolNameChange(value: string) {
    setSchoolName(value);
    if (!slugEdited) setSchoolSlug(slugify(value));
  }

  async function createSchool() {
    try {
      await callEdgeFunction("register-school", {
        schoolName,
        schoolSlug,
        currency: "XOF",
      });
      await refreshMemberships();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(
        err instanceof EdgeFunctionError
          ? err.message
          : "Erreur inattendue lors de la création de l'école.",
      );
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (!accountReady) {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (signUpError) {
        setError(
          signUpError.message.includes("already registered")
            ? "Un compte existe déjà avec cet email. Connectez-vous plutôt."
            : "Impossible de créer le compte.",
        );
        setSubmitting(false);
        return;
      }
      setAccountReady(true);
    }

    await createSchool();
    setSubmitting(false);
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <span className="sidebar-brand-icon">
            <School size={18} color="#fff" />
          </span>
          School Manage
        </div>
        <h1>Créer mon école</h1>
        <p className="muted">
          Inscrivez votre établissement et devenez directeur immédiatement — aucune validation manuelle requise.
        </p>

        {!accountReady && (
          <>
            <label>
              Votre nom complet
              <input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </>
        )}

        <label>
          Nom de l'école
          <input required value={schoolName} onChange={(e) => handleSchoolNameChange(e.target.value)} />
        </label>
        <label>
          Identifiant unique (slug)
          <input
            required
            value={schoolSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSchoolSlug(slugify(e.target.value));
            }}
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={submitting || !schoolName || !schoolSlug || (!accountReady && (!fullName || !email || !password))}>
          {submitting ? "Création…" : "Créer mon école"}
        </button>

        <p className="muted">
          Déjà un compte ? <Link to="/login">Se connecter</Link>
        </p>
      </form>
    </div>
  );
}
