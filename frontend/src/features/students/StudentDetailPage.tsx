import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { supabase } from "../../services/supabase/client";
import { formatAmount } from "../../lib/format";
import type { Guardian } from "../../types/domain";

interface GuardianLinkRow {
  id: string;
  guardianId: string;
  guardianName: string;
  relationship: string;
  isPrimary: boolean;
  canReceiveNotifications: boolean;
  canReceiveFinancialDocuments: boolean;
}

interface FeeAssignmentRow {
  id: string;
  scheduleLabel: string;
  baseAmount: number;
  discountAmount: number;
  exemption: boolean;
}

interface FeeScheduleOption {
  id: string;
  label: string;
  totalAmount: number;
}

export function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { currentSchoolId } = useAuth();

  const [student, setStudent] = useState<{ firstName: string; lastName: string; studentCode: string; status: string } | null>(
    null,
  );
  const [className, setClassName] = useState<string | null>(null);
  const [guardianLinks, setGuardianLinks] = useState<GuardianLinkRow[]>([]);
  const [allGuardians, setAllGuardians] = useState<Guardian[]>([]);
  const [selectedGuardianId, setSelectedGuardianId] = useState("");
  const [relationship, setRelationship] = useState<"father" | "mother" | "tutor" | "other">("father");

  const [assignments, setAssignments] = useState<FeeAssignmentRow[]>([]);
  const [scheduleOptions, setScheduleOptions] = useState<FeeScheduleOption[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [exemption, setExemption] = useState(false);
  const [schoolYearId, setSchoolYearId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    if (!currentSchoolId || !id) return;

    const { data: s } = await supabase
      .from("students")
      .select("first_name, last_name, student_code, status")
      .eq("id", id)
      .single();
    if (s) setStudent({ firstName: s.first_name, lastName: s.last_name, studentCode: s.student_code, status: s.status });

    const { data: year } = await supabase
      .from("school_years")
      .select("id")
      .eq("school_id", currentSchoolId)
      .eq("is_current", true)
      .maybeSingle();
    setSchoolYearId(year?.id ?? null);

    if (year) {
      const { data: enrollment } = await supabase
        .from("student_enrollments")
        .select("classes(name, level)")
        .eq("student_id", id)
        .eq("school_year_id", year.id)
        .maybeSingle();
      const cls = enrollment ? (Array.isArray(enrollment.classes) ? enrollment.classes[0] : enrollment.classes) : null;
      setClassName(cls ? `${cls.name} (${cls.level})` : null);
    }

    const { data: links } = await supabase
      .from("student_guardians")
      .select(
        "id, guardian_id, relationship, is_primary, can_receive_notifications, can_receive_financial_documents, guardians(first_name, last_name)",
      )
      .eq("student_id", id);
    setGuardianLinks(
      (links ?? []).map((l) => {
        const g = Array.isArray(l.guardians) ? l.guardians[0] : l.guardians;
        return {
          id: l.id,
          guardianId: l.guardian_id,
          guardianName: g ? `${g.first_name} ${g.last_name}` : "—",
          relationship: l.relationship,
          isPrimary: l.is_primary,
          canReceiveNotifications: l.can_receive_notifications,
          canReceiveFinancialDocuments: l.can_receive_financial_documents,
        };
      }),
    );

    const { data: guardiansData } = await supabase
      .from("guardians")
      .select("id, school_id, first_name, last_name, phone, email, preferred_channel, consent_whatsapp, consent_sms")
      .eq("school_id", currentSchoolId);
    setAllGuardians(
      (guardiansData ?? []).map((g) => ({
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

    if (year) {
      const { data: assignmentsData } = await supabase
        .from("student_fee_assignments")
        .select("id, base_amount, discount_amount, exemption, fee_schedules(label)")
        .eq("student_id", id)
        .eq("school_year_id", year.id);
      setAssignments(
        (assignmentsData ?? []).map((a) => {
          const schedule = Array.isArray(a.fee_schedules) ? a.fee_schedules[0] : a.fee_schedules;
          return {
            id: a.id,
            scheduleLabel: schedule?.label ?? "",
            baseAmount: a.base_amount,
            discountAmount: a.discount_amount,
            exemption: a.exemption,
          };
        }),
      );

      const { data: schedulesData } = await supabase
        .from("fee_schedules")
        .select("id, label, total_amount")
        .eq("school_id", currentSchoolId)
        .eq("school_year_id", year.id);
      setScheduleOptions(
        (schedulesData ?? []).map((s) => ({ id: s.id, label: s.label, totalAmount: s.total_amount })),
      );
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSchoolId, id]);

  async function handleAddGuardianLink() {
    if (!currentSchoolId || !id || !selectedGuardianId) return;
    setError(null);
    const { error: insertError } = await supabase.from("student_guardians").insert({
      school_id: currentSchoolId,
      student_id: id,
      guardian_id: selectedGuardianId,
      relationship,
      is_primary: guardianLinks.length === 0,
      can_receive_notifications: true,
      can_receive_financial_documents: true,
    });
    if (insertError) {
      setError("Impossible de lier ce responsable (déjà lié ?).");
      return;
    }
    setSelectedGuardianId("");
    await loadAll();
  }

  async function toggleFinancialDocs(linkId: string, current: boolean) {
    await supabase.from("student_guardians").update({ can_receive_financial_documents: !current }).eq("id", linkId);
    await loadAll();
  }

  async function handleAddAssignment() {
    if (!currentSchoolId || !id || !selectedScheduleId || !schoolYearId) return;
    setError(null);
    const schedule = scheduleOptions.find((s) => s.id === selectedScheduleId);
    if (!schedule) return;

    const { error: insertError } = await supabase.from("student_fee_assignments").insert({
      school_id: currentSchoolId,
      school_year_id: schoolYearId,
      student_id: id,
      fee_schedule_id: selectedScheduleId,
      base_amount: schedule.totalAmount,
      discount_amount: parseFloat(discountAmount) || 0,
      exemption,
    });
    if (insertError) {
      setError("Impossible d'affecter ce tarif (déjà affecté, ou réduction supérieure au montant de base).");
      return;
    }
    setSelectedScheduleId("");
    setDiscountAmount("0");
    setExemption(false);
    await loadAll();
  }

  if (!student) return <p>Chargement…</p>;

  return (
    <div>
      <h1>
        {student.lastName} {student.firstName} <span className="muted">({student.studentCode})</span>
      </h1>
      <p>
        Classe : <strong>{className ?? "Non affecté"}</strong> — Statut : {student.status}
      </p>

      <div className="page-header">
        <Link to={`/invoices?studentId=${id}`} className="button">
          Voir les factures
        </Link>
        <Link to={`/invoices/new?studentId=${id}`} className="button">
          + Facturer
        </Link>
      </div>

      {error && <p className="error-text">{error}</p>}

      <section className="card">
        <h2>Responsables</h2>
        <ul className="list">
          {guardianLinks.map((l) => (
            <li key={l.id}>
              {l.guardianName} — {l.relationship} {l.isPrimary && <span className="badge">Principal</span>}{" "}
              <label className="toggle-row" style={{ display: "inline-flex" }}>
                <input
                  type="checkbox"
                  checked={l.canReceiveFinancialDocuments}
                  onChange={() => toggleFinancialDocs(l.id, l.canReceiveFinancialDocuments)}
                />
                Reçoit factures/reçus
              </label>
            </li>
          ))}
          {guardianLinks.length === 0 && <li className="muted">Aucun responsable lié.</li>}
        </ul>

        <div className="allocation-row">
          <select value={selectedGuardianId} onChange={(e) => setSelectedGuardianId(e.target.value)}>
            <option value="">— Choisir un responsable existant —</option>
            {allGuardians.map((g) => (
              <option key={g.id} value={g.id}>
                {g.lastName} {g.firstName}
              </option>
            ))}
          </select>
          <select value={relationship} onChange={(e) => setRelationship(e.target.value as typeof relationship)}>
            <option value="father">Père</option>
            <option value="mother">Mère</option>
            <option value="tutor">Tuteur</option>
            <option value="other">Autre</option>
          </select>
          <button onClick={handleAddGuardianLink} disabled={!selectedGuardianId}>
            Lier
          </button>
        </div>
        <p className="muted">
          Pas encore de fiche pour ce responsable ? <Link to="/guardians/new">Créez-la d'abord</Link>.
        </p>
      </section>

      <section className="card">
        <h2>Tarifs affectés ({schoolYearId ? "année en cours" : "aucune année courante"})</h2>
        <ul className="list">
          {assignments.map((a) => (
            <li key={a.id}>
              {a.scheduleLabel} — base {formatAmount(a.baseAmount)}
              {a.exemption
                ? " — EXONÉRÉ"
                : a.discountAmount > 0
                  ? ` — réduction ${formatAmount(a.discountAmount)}`
                  : ""}
            </li>
          ))}
          {assignments.length === 0 && <li className="muted">Aucun tarif affecté.</li>}
        </ul>

        <div className="allocation-row">
          <select value={selectedScheduleId} onChange={(e) => setSelectedScheduleId(e.target.value)}>
            <option value="">— Choisir un tarif —</option>
            {scheduleOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({formatAmount(s.totalAmount)})
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Réduction"
            value={discountAmount}
            onChange={(e) => setDiscountAmount(e.target.value)}
          />
          <label className="toggle-row">
            <input type="checkbox" checked={exemption} onChange={(e) => setExemption(e.target.checked)} />
            Exonération totale
          </label>
          <button onClick={handleAddAssignment} disabled={!selectedScheduleId}>
            Affecter
          </button>
        </div>
        <p className="muted">
          Toute réduction/exonération est tracée dans le journal d'audit (voir Paramètres → Audit).
        </p>
      </section>
    </div>
  );
}
