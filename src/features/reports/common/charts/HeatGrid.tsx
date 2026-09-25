// WS-I-1 §5.8 / A7 — a hand-written SVG heat grid (busy hours). Grey level
// only, so it reads on a monochrome printer: white = 0, dark = the maximum.

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
}

const ROW_LABEL_WIDTH = 70;
const COL_LABEL_HEIGHT = 16;
const CELL_SIZE = 22;

export function HeatGrid({ cells, rowLabels, colLabels, testId }: HeatGridProps) {
  const max = Math.max(1, ...cells.map((c) => c.value));
  const width = ROW_LABEL_WIDTH + colLabels.length * CELL_SIZE;
  const height = COL_LABEL_HEIGHT + rowLabels.length * CELL_SIZE;

  return (
    <svg role="img" aria-label={testId} data-testid={testId} viewBox={`0 0 ${width} ${height}`} width="100%">
      {rowLabels.map((label, row) => (
        <text
          key={label}
          x={0}
          y={COL_LABEL_HEIGHT + row * CELL_SIZE + CELL_SIZE / 2}
          dominantBaseline="middle"
          fontSize="9"
        >
          {label}
        </text>
      ))}
      {colLabels.map((label, col) =>
        col % 3 === 0 ? (
          <text key={label} x={ROW_LABEL_WIDTH + col * CELL_SIZE} y={10} fontSize="8">
            {label}
          </text>
        ) : null,
      )}
      {cells.map((cell) => {
        const grey = 255 - Math.round((cell.value / max) * 200);
        return (
          <rect
            key={`${cell.row}-${cell.col}`}
            data-cell={`${cell.row}-${cell.col}`}
            x={ROW_LABEL_WIDTH + cell.col * CELL_SIZE}
            y={COL_LABEL_HEIGHT + cell.row * CELL_SIZE}
            width={CELL_SIZE - 1}
            height={CELL_SIZE - 1}
            fill={`rgb(${grey},${grey},${grey})`}
            stroke="#ccc"
          >
            <title>
              {rowLabels[cell.row]} {colLabels[cell.col]}: {cell.value}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
