interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

// Donut CSS pur (conic-gradient), pas de dépendance de charting pour un
// simple indicateur de répartition (ex : recouvré / restant / en retard).
export function Donut({ slices, centerLabel, centerValue }: { slices: DonutSlice[]; centerLabel: string; centerValue: string }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let cumulative = 0;
  const stops = slices
    .map((s) => {
      const start = total > 0 ? (cumulative / total) * 360 : 0;
      cumulative += s.value;
      const end = total > 0 ? (cumulative / total) * 360 : 0;
      return `${s.color} ${start}deg ${end}deg`;
    })
    .join(", ");

  return (
    <div className="donut-widget">
      <div className="donut" style={{ background: total > 0 ? `conic-gradient(${stops})` : "var(--border)" }}>
        <div className="donut-hole">
          <strong>{centerValue}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className="donut-legend">
        {slices.map((s) => (
          <div key={s.label} className="donut-legend-item">
            <span className="donut-dot" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
