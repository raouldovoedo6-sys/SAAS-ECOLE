import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";

export function GuardianFormPage() {
  const { currentSchoolId } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [preferredChannel, setPreferredChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [consentSms, setConsentSms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!currentSchoolId || !firstName || !lastName) return;
    setSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase.from("guardians").insert({
      school_id: currentSchoolId,
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      email: email || null,
      preferred_channel: preferredChannel,
      consent_whatsapp: consentWhatsapp,
      consent_sms: consentSms,
    });

    if (insertError) {
      setError("Impossible de créer ce responsable (droits insuffisants ?).");
      setSubmitting(false);
      return;
    }

    navigate("/guardians", { replace: true });
  }

  return (
    <div>
      <h1>Nouveau responsable</h1>

      <label>
        Prénom
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </label>
      <label>
        Nom
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </label>
      <label>
        Téléphone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+229…" />
      </label>
      <label>
        Email (optionnel)
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Canal préféré
        <select value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value as "whatsapp" | "sms")}>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
        </select>
      </label>

      <label className="toggle-row">
        <input type="checkbox" checked={consentWhatsapp} onChange={(e) => setConsentWhatsapp(e.target.checked)} />
        Consentement à recevoir des messages WhatsApp
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={consentSms} onChange={(e) => setConsentSms(e.target.checked)} />
        Consentement à recevoir des SMS
      </label>

      {error && <p className="error-text">{error}</p>}

      <button onClick={handleSubmit} disabled={submitting || !firstName || !lastName}>
        {submitting ? "Création…" : "Créer"}
      </button>
    </div>
  );
}
