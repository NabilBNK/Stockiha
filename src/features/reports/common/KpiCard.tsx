// WS-I-1 §5.8 — a single KPI figure with an optional comparison arrow.
// Reuses the existing .sk-kpi-card system (src/styles/historical-finance.css)
// rather than inventing new CSS, so Reports reads as the same design
// language as the Historical Finance analytics dashboard. The arrow glyph
// itself carries no colour (A7/A8 — printed output is monochrome and goes
// through a completely separate render path, renderOfficialDocumentHtml,
// that never touches this component); the on-screen accent bar/colour here
// is purely a screen affordance.

export interface KpiCardProps {
  label: string;
  value: string;
  previous?: string | null;
  testId: string;
  /** When true, a decrease is the favourable direction (e.g. Cancellations). */
  invertGood?: boolean;
}

function comparisonText(value: string, previous?: string | null): { text: string; good: boolean | null } {
  if (previous === null || previous === undefined) return { text: '', good: null };
  const prevNum = Number(previous);
  if (!Number.isFinite(prevNum) || prevNum === 0) return { text: '—', good: null };
  const valueNum = Number(value);
  const pct = Math.round(((valueNum - prevNum) / Math.abs(prevNum)) * 1000) / 10;
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '=';
  return { text: `${arrow} ${Math.abs(pct).toFixed(1)}%`, good: pct === 0 ? null : pct > 0 };
}

export function KpiCard({ label, value, previous, testId, invertGood }: KpiCardProps) {
  const { text, good } = comparisonText(value, previous);
  const favourable = good === null ? null : invertGood ? !good : good;
  const variant = favourable === null ? '' : favourable ? 'sk-kpi-card--success' : 'sk-kpi-card--danger';

  return (
    <div className={`sk-kpi-card ${variant}`} data-testid={testId}>
      <div className="sk-kpi-card__title">{label}</div>
      <div className="sk-kpi-card__value">{value}</div>
      {previous !== undefined ? (
        <div
          className="sk-kpi-card__subtitle"
          data-testid={`${testId}-comparison`}
          data-good={favourable === null ? undefined : String(favourable)}
        >
          {text}
        </div>
      ) : null}
    </div>
  );
}
