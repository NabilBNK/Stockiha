// WS-I-1 §5.8 & WS-R — a single KPI figure with comparison arrow and responsive card styling.
// Follows Stockiha design system tokens (.sk-kpi-card, logical borders, tone accents).

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

  // Highlight negative amounts (e.g. negative profit/loss)
  const isNegative = value.trim().startsWith('-');

  return (
    <div className={`sk-kpi-card ${variant}`} data-testid={testId}>
      <div className="sk-kpi-card__title">{label}</div>
      <div className={`sk-kpi-card__value ${isNegative ? 'sk-kpi-card__value--danger' : ''}`}>
        {value}
      </div>
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
