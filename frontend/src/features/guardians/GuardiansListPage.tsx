import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import type { Guardian } from "../../types/domain";

export function GuardiansListPage() {
  const { currentSchoolId } = useAuth();
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!currentSchoolId) return;
    let cancelled = false;
    supabase
      .from("guardians")
      .select("id, school_id, first_name, last_name, phone, email, preferred_channel, consent_whatsapp, consent_sms")
      .eq("school_id", currentSchoolId)
      .order("last_name", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setGuardians(
          (data ?? []).map((g) => ({
            id: g.id,
            schoolId: g.school_id,
            firstName: g.first_name,
            lastName: g.last_name,
            phone: g.phone,
            email: g.email,
            preferredChannel: g.preferred_channel,
            consentWhatsapp: g.consent_whatsapp,
            consentSms: g.consent_sms,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [currentSchoolId]);

  const filtered = guardians.filter((g) =>
    `${g.firstName} ${g.lastName} ${g.phone ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="page-header">
        <h1>Responsables</h1>
        <Link to="/guardians/new" className="button">
          + Nouveau responsable
        </Link>
      </div>

      <input
        type="search"
        placeholder="Rechercher…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="search-input"
      />

      <ul className="list">
        {filtered.map((g) => (
          <li key={g.id}>
            {g.lastName} {g.firstName} — <span className="muted">{g.phone ?? "sans téléphone"}</span>{" "}
            {g.consentWhatsapp && <span className="badge">WhatsApp OK</span>}{" "}
            {g.consentSms && <span className="badge">SMS OK</span>}
          </li>
        ))}
        {filtered.length === 0 && <li className="muted">Aucun responsable.</li>}
      </ul>
    </div>
  );
}
