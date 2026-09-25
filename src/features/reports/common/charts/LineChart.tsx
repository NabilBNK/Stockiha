// WS-I-1 §5.8 / A7 — a hand-written SVG line chart, black lines only, the
// second series dashed so it reads without colour.

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
}

const WIDTH = 640;
const MAX_X_LABELS = 12;

export function LineChart({ series, height = 180, formatValue, testId }: LineChartProps) {
  const copy = useReportCopy();
  const pointCount = series[0]?.points.length ?? 0;
  if (series.length === 0 || pointCount === 0) {
    return (
      <div data-testid={testId} className="sk-chart sk-chart--empty">
        {copy.noData}
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

  return (
    <svg role="img" aria-label={testId} data-testid={testId} viewBox={`0 0 ${WIDTH} ${height}`} width="100%">
      {series.map((s) => {
        const path = s.points.map((p, i) => toXY(i, p.value).join(',')).join(' ');
        return (
          <polyline
            key={s.name}
            points={path}
            fill="none"
            stroke="#000"
            strokeWidth={1.5}
            strokeDasharray={s.dashed ? '5,4' : undefined}
          />
        );
      })}
      {labels.map((label, index) =>
        index % labelStride === 0 ? (
          <text key={label} x={toXY(index, 0)[0]} y={height - 4} fontSize="10" textAnchor="middle">
            {label}
          </text>
        ) : null,
      )}
      <g transform={`translate(0, ${plotHeight + 14})`} fontSize="10">
        {series.map((s, index) => (
          <text key={s.name} x={index * 120} y={0}>
            {s.dashed ? '- - ' : '— '}
            {s.name}
          </text>
        ))}
      </g>
      <title>
        {series.map((s) => `${s.name}: ${s.points.map((p) => formatValue(p.value)).join(', ')}`).join(' | ')}
      </title>
    </svg>
  );
}
