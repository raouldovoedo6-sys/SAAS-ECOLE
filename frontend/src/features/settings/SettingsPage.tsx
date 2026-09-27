import { useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";

interface ReminderRule {
  id: string;
  name: string;
  offsetDays: number;
  channel: string;
  active: boolean;
}

interface ChannelSetting {
  channel: "whatsapp" | "sms";
  enabled: boolean;
}

// Écran réservé au directeur (RequireRole + RLS : fee_schedules/reminder_
// rules/notification_channel_settings n'acceptent d'écriture que pour le
// rôle 'director', voir migration RLS).
export function SettingsPage() {
  const { currentSchoolId } = useAuth();
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [channels, setChannels] = useState<ChannelSetting[]>([
    { channel: "whatsapp", enabled: false },
    { channel: "sms", enabled: false },
  ]);
  const [newRule, setNewRule] = useState({ name: "", offsetDays: -7, channel: "sms" as string });
  const [error, setError] = useState<string | null>(null);

  async function loadRules() {
    if (!currentSchoolId) return;
    const { data } = await supabase
      .from("reminder_rules")
      .select("id, name, offset_days, channel, active")
      .eq("school_id", currentSchoolId)
      .order("offset_days", { ascending: true });
    setRules((data ?? []).map((r) => ({ id: r.id, name: r.name, offsetDays: r.offset_days, channel: r.channel, active: r.active })));
  }

  async function loadChannels() {
    if (!currentSchoolId) return;
    const { data } = await supabase
      .from("notification_channel_settings")
      .select("channel, enabled")
      .eq("school_id", currentSchoolId);
    if (data && data.length > 0) {
      setChannels(data.map((c) => ({ channel: c.channel, enabled: c.enabled })));
    }
  }

  useEffect(() => {
    loadRules();
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId]);

  async function toggleChannel(channel: "whatsapp" | "sms", enabled: boolean) {
    if (!currentSchoolId) return;
    setError(null);
    const { error: upsertError } = await supabase
      .from("notification_channel_settings")
      .upsert({ school_id: currentSchoolId, channel, enabled }, { onConflict: "school_id,channel" });
    if (upsertError) {
      setError("Impossible de mettre à jour le canal (droits insuffisants ?).");
      return;
    }
    setChannels((prev) => prev.map((c) => (c.channel === channel ? { ...c, enabled } : c)));
  }

  async function addRule() {
    if (!currentSchoolId || !newRule.name) return;
    setError(null);
    const { error: insertError } = await supabase.from("reminder_rules").insert({
      school_id: currentSchoolId,
      name: newRule.name,
      offset_days: newRule.offsetDays,
      channel: newRule.channel,
      template_name: "generic_reminder",
      active: true,
    });
    if (insertError) {
      setError("Impossible de créer la règle (droits insuffisants ?).");
      return;
    }
    setNewRule({ name: "", offsetDays: -7, channel: "sms" });
    await loadRules();
  }

  async function toggleRuleActive(rule: ReminderRule) {
    await supabase.from("reminder_rules").update({ active: !rule.active }).eq("id", rule.id);
    await loadRules();
  }

  return (
    <div>
      <h1>Paramètres</h1>
      {error && <p className="error-text">{error}</p>}

      <section className="card">
        <h2>Canaux de notification</h2>
        <p className="muted">
          Tant qu'un canal n'est pas configuré côté fournisseur (secrets serveur), aucun message réel n'est envoyé
          même si activé ici.
        </p>
        {channels.map((c) => (
          <label key={c.channel} className="toggle-row">
            <input
              type="checkbox"
              checked={c.enabled}
              onChange={(e) => toggleChannel(c.channel, e.target.checked)}
            />
            {c.channel === "whatsapp" ? "WhatsApp" : "SMS"}
          </label>
        ))}
      </section>

      <section className="card">
        <h2>Règles de rappel automatique</h2>
        <ul className="list">
          {rules.map((r) => (
            <li key={r.id}>
              {r.name} — J{r.offsetDays >= 0 ? "+" : ""}
              {r.offsetDays} — {r.channel}{" "}
              <button onClick={() => toggleRuleActive(r)}>{r.active ? "Désactiver" : "Activer"}</button>
            </li>
          ))}
        </ul>

        <div className="new-rule-form">
          <input
            placeholder="Nom (ex: Rappel J-7)"
            value={newRule.name}
            onChange={(e) => setNewRule((prev) => ({ ...prev, name: e.target.value }))}
          />
          <input
            type="number"
            value={newRule.offsetDays}
            onChange={(e) => setNewRule((prev) => ({ ...prev, offsetDays: parseInt(e.target.value, 10) || 0 }))}
          />
          <select
            value={newRule.channel}
            onChange={(e) => setNewRule((prev) => ({ ...prev, channel: e.target.value }))}
          >
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="both">Les deux</option>
          </select>
          <button onClick={addRule}>Ajouter</button>
        </div>
      </section>
    </div>
  );
}
