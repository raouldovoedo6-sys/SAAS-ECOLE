import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import type { FeeCategory } from "../../types/domain";

interface DraftInstallment {
  label: string;
  amount: string;
  dueDate: string;
}

export function FeeScheduleFormPage() {
  const { currentSchoolId } = useAuth();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [label, setLabel] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [installments, setInstallments] = useState<DraftInstallment[]>([
    { label: "1re tranche", amount: "", dueDate: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentSchoolId) return;
    supabase
      .from("fee_categories")
      .select("id, code, name")
      .eq("school_id", currentSchoolId)
      .then(({ data }) => setCategories(data ?? []));
  }, [currentSchoolId]);

  function updateInstallment(index: number, patch: Partial<DraftInstallment>) {
    setInstallments((prev) => prev.map((inst, i) => (i === index ? { ...inst, ...patch } : inst)));
  }

  function addInstallment() {
    setInstallments((prev) => [...prev, { label: `Tranche ${prev.length + 1}`, amount: "", dueDate: "" }]);
  }

  function removeInstallment(index: number) {
    setInstallments((prev) => prev.filter((_, i) => i !== index));
  }

  const installmentsSum = installments.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

  async function handleSubmit() {
    if (!currentSchoolId || !categoryId || !label || !totalAmount) return;

    const total = parseFloat(totalAmount);
    if (installmentsSum > total) {
      setError("La somme des tranches ne peut pas dépasser le montant total (vérifié aussi côté serveur).");
      return;
    }
    if (installments.some((i) => !i.amount || !i.dueDate)) {
      setError("Chaque tranche doit avoir un montant et une échéance.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const { data: year } = await supabase
      .from("school_years")
      .select("id")
      .eq("school_id", currentSchoolId)
      .eq("is_current", true)
      .maybeSingle();

    if (!year) {
      setError("Aucune année scolaire courante définie.");
      setSubmitting(false);
      return;
    }

    const { data: schedule, error: scheduleError } = await supabase
      .from("fee_schedules")
      .insert({
        school_id: currentSchoolId,
        school_year_id: year.id,
        fee_category_id: categoryId,
        label,
        total_amount: total,
      })
      .select("id")
      .single();

    if (scheduleError || !schedule) {
      setError("Impossible de créer le tarif (droits insuffisants ?).");
      setSubmitting(false);
      return;
    }

    const { error: installmentsError } = await supabase.from("fee_installments").insert(
      installments.map((inst, index) => ({
        school_id: currentSchoolId,
        fee_schedule_id: schedule.id,
        label: inst.label,
        sequence: index + 1,
        amount: parseFloat(inst.amount),
        due_date: inst.dueDate,
      })),
    );

    if (installmentsError) {
      setError("Tarif créé, mais erreur lors de l'ajout des tranches (la somme dépasse peut-être le total).");
      setSubmitting(false);
      return;
    }

    navigate("/fees/schedules", { replace: true });
  }

  return (
    <div>
      <h1>Nouveau tarif</h1>

      <label>
        Catégorie
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">— Choisir —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Libellé (ex : Scolarité CM2)
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label>
        Montant total
        <input type="number" min={0} step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} />
      </label>

      <div className="card">
        <h2>Tranches (échéances)</h2>
        {installments.map((inst, index) => (
          <div key={index} className="allocation-row">
            <input
              placeholder="Libellé"
              value={inst.label}
              onChange={(e) => updateInstallment(index, { label: e.target.value })}
            />
            <input
              type="number"
              placeholder="Montant"
              value={inst.amount}
              onChange={(e) => updateInstallment(index, { amount: e.target.value })}
            />
            <input
              type="date"
              value={inst.dueDate}
              onChange={(e) => updateInstallment(index, { dueDate: e.target.value })}
            />
            <button onClick={() => removeInstallment(index)}>Retirer</button>
          </div>
        ))}
        <button onClick={addInstallment}>+ Ajouter une tranche</button>
        <p>
          Somme des tranches : {installmentsSum} {totalAmount && `/ ${totalAmount}`}
        </p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <button onClick={handleSubmit} disabled={submitting || !categoryId || !label || !totalAmount}>
        {submitting ? "Création…" : "Créer le tarif"}
      </button>
    </div>
  );
}
