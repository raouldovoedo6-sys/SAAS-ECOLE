import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";

interface MethodRow {
  id: string;
  type: string;
  label: string;
  active: boolean;
}

// Moyens de paiement OFFICIELS communiqués aux parents (espèces, Mobile
// Money de l'école, virement…). Rappel : aucun encaissement en ligne n'est
// traité par l'application — le parent paie par ces canaux, et le
// comptable enregistre ensuite le paiement (voir docs/ARCHITECTURE.md §8).
export function PaymentMethodsPage() {
  const { currentSchoolId } = useAuth();
  const [methods, setMethods] = useState<MethodRow[]>([]);
  const [type, setType] = useState<"cash" | "mobile_money" | "bank_transfer" | "other">("mobile_money");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!currentSchoolId) return;
    const { data } = await supabase
      .from("school_payment_methods")
      .select("id, type, label, active")
      .eq("school_id", currentSchoolId);
    setMethods(data ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId]);

  async function handleCreate() {
    if (!currentSchoolId || !label) return;
    setError(null);
    const { error: insertError } = await supabase
      .from("school_payment_methods")
      .insert({ school_id: currentSchoolId, type, label, active: true });
    if (insertError) {
      setError("Impossible de créer ce moyen de paiement.");
      return;
    }
    setLabel("");
    await load();
  }

  async function toggleActive(method: MethodRow) {
    await supabase.from("school_payment_methods").update({ active: !method.active }).eq("id", method.id);
    await load();
  }

  return (
    <div>
      <h1>Moyens de paiement officiels</h1>
      <p className="muted">
        Ces informations sont affichées aux responsables pour qu'ils sachent comment régler les frais (espèces sur
        place, numéro Mobile Money officiel, etc.). Le paiement lui-même se fait toujours en dehors de l'application.
      </p>

      <ul className="list">
        {methods.map((m) => (
          <li key={m.id}>
            {m.label} ({m.type}) {!m.active && <span className="muted">— inactif</span>}{" "}
            <button onClick={() => toggleActive(m)}>{m.active ? "Désactiver" : "Activer"}</button>
          </li>
        ))}
        {methods.length === 0 && <li className="muted">Aucun moyen de paiement configuré.</li>}
      </ul>

      <div className="card">
        <h2>Nouveau moyen de paiement</h2>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="cash">Espèces</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="bank_transfer">Virement bancaire</option>
            <option value="other">Autre</option>
          </select>
        </label>
        <label>
          Libellé (ex : MTN MoMo 90 00 00 00)
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button onClick={handleCreate} disabled={!label}>
          Ajouter
        </button>
      </div>
    </div>
  );
}
