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
const SERIES_COLORS = ['var(--sk-chart-sales, #2a78d6)', 'var(--sk-chart-benefit, #7c5ce5)', 'var(--sk-chart-purchases, #19a875)'];

const PADDING_LEFT = 56;
const PADDING_RIGHT = 36;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 30;

export function LineChart({ series, height = 230, formatValue, testId, title }: LineChartProps) {
  const copy = useReportCopy();
  const pointCount = series[0]?.points.length ?? 0;
  const displayTitle = title ?? copy.salesOverTime;

  if (series.length === 0 || pointCount === 0) {
    return (
      <div className="sk-chart-card">
        {displayTitle ? (
          <div className="sk-chart-card__header">
            <h3 className="sk-chart-card__title">{displayTitle}</h3>
          </div>
        ) : null}
        <div className="sk-chart-empty" data-testid={testId}>
          {copy.noData}
        </div>
      </div>
    );
  }

  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = height - PADDING_TOP - PADDING_BOTTOM;

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const rawMax = Math.max(0, ...allValues);
  const rawMin = Math.min(0, ...allValues);
  // Add 10% headroom above rawMax so peak points do not touch the ceiling
  const max = rawMax === 0 ? 100 : rawMax * 1.1;
  const min = rawMin;
  const range = max - min || 1;
  const stepX = pointCount > 1 ? plotWidth / (pointCount - 1) : 0;

  function toXY(index: number, value: number): [number, number] {
    const x = PADDING_LEFT + (pointCount > 1 ? index * stepX : plotWidth / 2);
    const y = PADDING_TOP + plotHeight - ((value - min) / range) * plotHeight;
    return [x, y];
  }

  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const labelStride = Math.max(1, Math.ceil(labels.length / MAX_X_LABELS));

  // Y-axis horizontal gridlines (0%, 33%, 66%, 100%)
  const yTicks = [0, 0.33, 0.66, 1.0].map((ratio) => {
    const val = min + ratio * (max - min);
    const y = PADDING_TOP + plotHeight - ratio * plotHeight;
    return { val, y, isBase: ratio === 0 };
  });

  return (
    <div className="sk-chart-card">
      <div className="sk-chart-card__header">
        <h3 className="sk-chart-card__title">{displayTitle}</h3>
        <div className="sk-chart-legend">
          {series.map((s, seriesIndex) => (
            <span className="sk-chart-legend__item" key={s.name}>
              <span
                className="sk-chart-legend__dot"
                style={{
                  background: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
                  ...(s.dashed
                    ? { border: `1px dashed ${SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}`, background: 'transparent' }
                    : {}),
                }}
              />
              {s.name}
            </span>
          ))}
        </div>
      </div>

      <div className="sk-chart-container" dir="ltr">
        <svg
          role="img"
          aria-label={testId}
          data-testid={testId}
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="sk-chart-svg"
          style={{ height, width: '100%' }}
        >
          <defs>
            {series.map((_s, seriesIndex) => {
              const gradId = `chart-grad-${testId}-${seriesIndex}`;
              const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
              return (
                <linearGradient key={gradId} id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                  <stop offset="90%" stopColor={color} stopOpacity="0.02" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              );
            })}
          </defs>

          {/* Horizontal gridlines and Y-axis tick values */}
          {yTicks.map((tick, i) => (
            <g key={i} className="sk-chart-grid-line">
              <line
                x1={PADDING_LEFT}
                y1={tick.y}
                x2={WIDTH - PADDING_RIGHT}
                y2={tick.y}
                stroke="var(--sk-border, #e5e7eb)"
                strokeWidth={1}
                strokeDasharray={tick.isBase ? undefined : '3,3'}
                opacity={0.8}
              />
              <text
                x={PADDING_LEFT - 8}
                y={tick.y + 3.5}
                fontSize="10"
                fill="var(--sk-text-soft, #6b7280)"
                textAnchor="end"
              >
                {formatValue(tick.val)}
              </text>
            </g>
          ))}

          {/* Area gradients beneath lines */}
          {series.map((s, seriesIndex) => {
            if (s.dashed || s.points.length === 0) return null;
            const areaPoints = [
              `${toXY(0, min)[0]},${PADDING_TOP + plotHeight}`,
              ...s.points.map((p, i) => toXY(i, p.value).join(',')),
              `${toXY(s.points.length - 1, min)[0]},${PADDING_TOP + plotHeight}`,
            ].join(' ');
            const gradId = `chart-grad-${testId}-${seriesIndex}`;
            return (
              <polygon
                key={`area-${s.name}`}
                points={areaPoints}
                fill={`url(#${gradId})`}
              />
            );
          })}

          {/* Series polylines */}
          {series.map((s, seriesIndex) => {
            const path = s.points.map((p, i) => toXY(i, p.value).join(',')).join(' ');
            const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
            return (
              <polyline
                key={s.name}
                points={path}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '6,5' : undefined}
              />
            );
          })}

          {/* Data point markers */}
          {series.map((s, seriesIndex) => {
            const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
            return s.points.map((p, i) => {
              const [cx, cy] = toXY(i, p.value);
              return (
                <circle
                  key={`point-${s.name}-${i}`}
                  cx={cx}
                  cy={cy}
                  r={pointCount > 24 ? 2.5 : 3.5}
                  fill="var(--sk-surface, #ffffff)"
                  stroke={color}
                  strokeWidth={2}
                >
                  <title>{`${p.label} — ${s.name}: ${formatValue(p.value)}`}</title>
                </circle>
              );
            });
          })}

          {/* X-axis date labels */}
          {labels.map((label, index) => {
            if (index % labelStride !== 0) return null;
            const [x] = toXY(index, 0);
            const displayLabel = label.length === 10 && label[4] === '-' ? label.slice(5) : label;
            return (
              <text
                key={label}
                x={x}
                y={height - 10}
                fontSize="10"
                fill="var(--sk-text-soft, #6b7280)"
                textAnchor="middle"
                fontWeight="500"
              >
                {displayLabel}
              </text>
            );
          })}

          <title>
            {series.map((s) => `${s.name}: ${s.points.map((p) => formatValue(p.value)).join(', ')}`).join(' | ')}
          </title>
        </svg>
      </div>
    </div>
  );
}
