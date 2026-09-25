// WS-I-1 §5.8 / A7 — a hand-written SVG line chart. Reuses .sk-chart-*
// (src/styles/historical-finance.css) for sizing/theme; the legend moved
// out of the SVG into a real HTML `.sk-chart-legend`, matching the existing
// analytics-dashboard chart pattern.

import { useReportCopy } from '../reportCopy';

export interface LineChartPoint {
  label: string;
  value: number;
}

export interface LineChartSeries {
  name: string;
  points: LineChartPoint[];
  dashed?: boolean;
}

export interface LineChartProps {
  series: LineChartSeries[];
  height?: number;
  formatValue: (n: number) => string;
  testId: string;
  title?: string;
}

const WIDTH = 640;
const MAX_X_LABELS = 12;
const SERIES_COLORS = ['var(--sk-chart-sales)', 'var(--sk-chart-benefit)', 'var(--sk-chart-purchases)'];

export function LineChart({ series, height = 220, formatValue, testId, title }: LineChartProps) {
  const copy = useReportCopy();
  const pointCount = series[0]?.points.length ?? 0;

  if (series.length === 0 || pointCount === 0) {
    const empty = (
      <div className="sk-chart-empty" data-testid={testId}>
        {copy.noData}
      </div>
    );
    if (!title) return empty;
    return (
      <div className="sk-chart-card">
        <div className="sk-chart-card__header">
          <h3 className="sk-chart-card__title">{title}</h3>
        </div>
        {empty}
      </div>
    );
  }

  const labelSpace = 24;
  const plotHeight = height - labelSpace;
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = Math.max(1, ...allValues);
  const min = Math.min(0, ...allValues);
  const range = max - min || 1;
  const stepX = pointCount > 1 ? WIDTH / (pointCount - 1) : 0;

  function toXY(index: number, value: number): [number, number] {
    const x = pointCount > 1 ? index * stepX : WIDTH / 2;
    const y = plotHeight - ((value - min) / range) * plotHeight;
    return [x, y];
  }

  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const labelStride = Math.max(1, Math.ceil(labels.length / MAX_X_LABELS));

  const body = (
    <>
      <div className="sk-chart-container">
        <svg role="img" aria-label={testId} data-testid={testId} viewBox={`0 0 ${WIDTH} ${height}`} className="sk-chart-svg" style={{ height }}>
          {series.map((s, seriesIndex) => {
            const path = s.points.map((p, i) => toXY(i, p.value).join(',')).join(' ');
            return (
              <polyline
                key={s.name}
                points={path}
                fill="none"
                stroke={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '6,5' : undefined}
              />
            );
          })}
          {labels.map((label, index) =>
            index % labelStride === 0 ? (
              <text key={label} x={toXY(index, 0)[0]} y={height - 6} fontSize="10" fill="var(--sk-text-soft)" textAnchor="middle">
                {label}
              </text>
            ) : null,
          )}
          <title>
            {series.map((s) => `${s.name}: ${s.points.map((p) => formatValue(p.value)).join(', ')}`).join(' | ')}
          </title>
        </svg>
      </div>
      <div className="sk-chart-legend">
        {series.map((s, seriesIndex) => (
          <span className="sk-chart-legend__item" key={s.name}>
            <span
              className="sk-chart-legend__dot"
              style={{
                background: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
                ...(s.dashed ? { border: `1px dashed ${SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}`, background: 'transparent' } : {}),
              }}
            />
            {s.name}
          </span>
        ))}
      </div>
    </>
  );

  if (!title) return body;
  return (
    <div className="sk-chart-card">
      <div className="sk-chart-card__header">
        <h3 className="sk-chart-card__title">{title}</h3>
      </div>
      {body}
    </div>
  );
}
