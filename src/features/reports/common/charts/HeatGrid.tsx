// WS-I-1 §5.8 / A7 — a hand-written SVG heat grid (busy hours). Grey level
// only, so it reads on a monochrome printer: white = 0, dark = the maximum.
// Wrapped in the existing .sk-chart-card system for consistent framing;
// labels use theme tokens so they stay legible in dark mode.

export interface HeatGridCell {
  row: number;
  col: number;
  value: number;
}

export interface HeatGridProps {
  cells: HeatGridCell[];
  rowLabels: string[];
  colLabels: string[];
  testId: string;
  title?: string;
}

const ROW_LABEL_WIDTH = 76;
const COL_LABEL_HEIGHT = 18;
const CELL_SIZE = 24;

export function HeatGrid({ cells, rowLabels, colLabels, testId, title }: HeatGridProps) {
  const max = Math.max(1, ...cells.map((c) => c.value));
  const width = ROW_LABEL_WIDTH + colLabels.length * CELL_SIZE;
  const height = COL_LABEL_HEIGHT + rowLabels.length * CELL_SIZE;

  const body = (
    <div className="sk-chart-container">
      <svg
        role="img"
        aria-label={testId}
        data-testid={testId}
        viewBox={`0 0 ${width} ${height}`}
        className="sk-chart-svg"
        style={{ height, minWidth: width }}
      >
        {rowLabels.map((label, row) => (
          <text
            key={label}
            x={0}
            y={COL_LABEL_HEIGHT + row * CELL_SIZE + CELL_SIZE / 2}
            dominantBaseline="middle"
            fontSize="10"
            fill="var(--sk-text-soft)"
          >
            {label}
          </text>
        ))}
        {colLabels.map((label, col) =>
          col % 3 === 0 ? (
            <text key={label} x={ROW_LABEL_WIDTH + col * CELL_SIZE} y={11} fontSize="9" fill="var(--sk-text-soft)">
              {label}
            </text>
          ) : null,
        )}
        {cells.map((cell) => {
          const intensity = cell.value / max;
          return (
            <rect
              key={`${cell.row}-${cell.col}`}
              data-cell={`${cell.row}-${cell.col}`}
              x={ROW_LABEL_WIDTH + cell.col * CELL_SIZE}
              y={COL_LABEL_HEIGHT + cell.row * CELL_SIZE}
              width={CELL_SIZE - 1.5}
              height={CELL_SIZE - 1.5}
              rx={2}
              fill="var(--sk-chart-sales)"
              fillOpacity={cell.value === 0 ? 0.05 : 0.15 + intensity * 0.8}
              stroke="var(--sk-border)"
            >
              <title>
                {rowLabels[cell.row]} {colLabels[cell.col]}: {cell.value}
              </title>
            </rect>
          );
        })}
      </svg>
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
