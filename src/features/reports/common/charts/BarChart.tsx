// WS-I-1 §5.8 / A7 — a hand-written SVG bar chart. No chart library (R-05):
// black-and-white friendly, no animation.

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
}

const WIDTH = 640;

export function BarChart({ points, height = 180, formatValue, testId, horizontal }: BarChartProps) {
  const copy = useReportCopy();
  if (points.length === 0) {
    return (
      <div data-testid={testId} className="sk-chart sk-chart--empty">
        {copy.noData}
      </div>
    );
  }

  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const showValues = points.length <= 15;
  const gap = 6;
  const labelSpace = horizontal ? 90 : 24;

  if (horizontal) {
    const rowHeight = Math.max(18, (height - labelSpace) / points.length);
    const barAreaWidth = WIDTH - labelSpace - 60;
    return (
      <svg
        role="img"
        aria-label={testId}
        data-testid={testId}
        viewBox={`0 0 ${WIDTH} ${points.length * rowHeight + gap}`}
        width="100%"
      >
        {points.map((point, index) => {
          const barWidth = Math.max(1, (Math.abs(point.value) / max) * barAreaWidth);
          const y = index * rowHeight;
          return (
            <g key={point.label}>
              <text x={0} y={y + rowHeight / 2} dominantBaseline="middle" fontSize="11">
                {point.label}
              </text>
              <rect
                x={labelSpace}
                y={y + rowHeight * 0.15}
                width={barWidth}
                height={rowHeight * 0.7}
                fill={point.value === 0 ? '#999' : '#555'}
              />
              {showValues ? (
                <text x={labelSpace + barWidth + 4} y={y + rowHeight / 2} dominantBaseline="middle" fontSize="11">
                  {formatValue(point.value)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    );
  }

  const barAreaHeight = height - labelSpace;
  const barWidth = Math.max(1, WIDTH / points.length - gap);
  return (
    <svg role="img" aria-label={testId} data-testid={testId} viewBox={`0 0 ${WIDTH} ${height}`} width="100%">
      {points.map((point, index) => {
        const barHeight = Math.max(1, (Math.abs(point.value) / max) * barAreaHeight);
        const x = index * (barWidth + gap);
        const y = barAreaHeight - barHeight;
        return (
          <g key={point.label}>
            <rect x={x} y={y} width={barWidth} height={barHeight} fill={point.value === 0 ? '#999' : '#555'} />
            {showValues ? (
              <text x={x + barWidth / 2} y={y - 4} fontSize="11" textAnchor="middle">
                {formatValue(point.value)}
              </text>
            ) : null}
            <text x={x + barWidth / 2} y={height - 6} fontSize="10" textAnchor="middle">
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
