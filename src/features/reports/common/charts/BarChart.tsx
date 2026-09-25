// WS-I-1 §5.8 / A7 — a hand-written SVG bar chart. No charting library
// dependency; reuses the existing .sk-chart-card/.sk-chart-svg system
// (src/styles/historical-finance.css) for sizing/theme so it renders
// correctly (the previous version had no explicit display/height and
// rendered as a squashed, misshapen shape) and reads as the same visual
// language as the rest of the app in both light/dark and LTR/RTL.

import { useReportCopy } from '../reportCopy';

export interface BarChartPoint {
  label: string;
  value: number;
}

export interface BarChartProps {
  points: BarChartPoint[];
  height?: number;
  formatValue: (n: number) => string;
  testId: string;
  horizontal?: boolean;
  title?: string;
}

const WIDTH = 640;

export function BarChart({ points, height = 220, formatValue, testId, horizontal, title }: BarChartProps) {
  const copy = useReportCopy();

  const body =
    points.length === 0 ? (
      <div className="sk-chart-empty" data-testid={testId}>
        {copy.noData}
      </div>
    ) : (
      <div className="sk-chart-container">
        {horizontal ? (
          <HorizontalBars points={points} height={height} formatValue={formatValue} testId={testId} />
        ) : (
          <VerticalBars points={points} height={height} formatValue={formatValue} testId={testId} />
        )}
      </div>
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

interface BarsProps {
  points: BarChartPoint[];
  height: number;
  formatValue: (n: number) => string;
  testId: string;
}

function HorizontalBars({ points, height, formatValue, testId }: BarsProps) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const showValues = points.length <= 15;
  const labelSpace = 100;
  const rowHeight = Math.max(20, (height - 8) / Math.max(points.length, 1));
  const barAreaWidth = WIDTH - labelSpace - 60;

  return (
    <svg
      role="img"
      aria-label={testId}
      data-testid={testId}
      viewBox={`0 0 ${WIDTH} ${points.length * rowHeight + 8}`}
      className="sk-chart-svg"
      style={{ height: points.length * rowHeight + 8 }}
    >
      {points.map((point, index) => {
        const barWidth = Math.max(1, (Math.abs(point.value) / max) * barAreaWidth);
        const y = index * rowHeight;
        return (
          <g key={point.label}>
            <text x={0} y={y + rowHeight / 2} dominantBaseline="middle" fontSize="11" fill="var(--sk-text-soft)">
              {point.label.length > 16 ? `${point.label.slice(0, 15)}…` : point.label}
            </text>
            <rect
              x={labelSpace}
              y={y + rowHeight * 0.18}
              width={barWidth}
              height={rowHeight * 0.64}
              rx={3}
              fill={point.value === 0 ? 'var(--sk-border-strong)' : 'var(--sk-chart-sales)'}
            />
            {showValues ? (
              <text
                x={labelSpace + barWidth + 6}
                y={y + rowHeight / 2}
                dominantBaseline="middle"
                fontSize="11"
                fill="var(--sk-text)"
                fontWeight={650}
              >
                {formatValue(point.value)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function VerticalBars({ points, height, formatValue, testId }: BarsProps) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const showValues = points.length <= 15;
  const labelSpace = 28;
  const gap = points.length > 40 ? 1 : 6;
  const barAreaHeight = height - labelSpace - (showValues ? 18 : 0);
  const barWidth = Math.max(1, WIDTH / points.length - gap);

  return (
    <svg
      role="img"
      aria-label={testId}
      data-testid={testId}
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="sk-chart-svg"
      style={{ height }}
    >
      {points.map((point, index) => {
        const barHeight = Math.max(1, (Math.abs(point.value) / max) * barAreaHeight);
        const x = index * (barWidth + gap);
        const y = height - labelSpace - barHeight;
        return (
          <g key={point.label}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={2}
              fill={point.value === 0 ? 'var(--sk-border-strong)' : 'var(--sk-chart-sales)'}
            />
            {showValues ? (
              <text x={x + barWidth / 2} y={y - 6} fontSize="10.5" fill="var(--sk-text)" fontWeight={650} textAnchor="middle">
                {formatValue(point.value)}
              </text>
            ) : null}
            <text
              x={x + barWidth / 2}
              y={height - 8}
              fontSize="10"
              fill="var(--sk-text-soft)"
              textAnchor="middle"
            >
              {points.length > 20 && index % Math.ceil(points.length / 20) !== 0 ? '' : point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
