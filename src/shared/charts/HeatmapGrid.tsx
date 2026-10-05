import { useState } from 'react';
import { heatClass } from './chartFormat';

export interface HeatmapCell {
  weekday: number;
  hour: number;
  count: number;
  valueText: string;
}

export interface HeatmapGridProps {
  cells: HeatmapCell[];
  dayLabels: string[];
  cellLabel: (cell: HeatmapCell) => string;
  legend: {
    fewer: string;
    more: string;
    none: string;
  };
}

export function HeatmapGrid({
  cells,
  dayLabels,
  cellLabel,
  legend,
}: HeatmapGridProps) {
  const [activeCell, setActiveCell] = useState<{
    cell: HeatmapCell;
    x: number;
    y: number;
  } | null>(null);

  // Maximum count across all 168 cells
  const maxCount = Math.max(...cells.map((c) => c.count), 0);

  // Index cells by `${weekday}-${hour}`
  const cellMap = new Map<string, HeatmapCell>();
  for (const cell of cells) {
    cellMap.set(`${cell.weekday}-${cell.hour}`, cell);
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const weekdays = [0, 1, 2, 3, 4, 5, 6]; // Sunday (0) to Saturday (6)

  return (
    <div className="sk-heatmap-wrapper">
      <div className="sk-heatmap-scroll">
        <div className="sk-heatmap-grid" role="grid" aria-readonly="true">
          {/* Header row: corner spacer + 24 hours */}
          <div className="sk-heatmap-row sk-heatmap-row--header">
            <span className="sk-heatmap-day-label sk-heatmap-day-label--corner" />
            {hours.map((h) => {
              const showText = h % 3 === 0;
              const text = h < 10 ? `0${h}` : `${h}`;
              return (
                <span
                  key={h}
                  className="sk-heatmap-hour-label sk-muted sk-body-xs"
                  aria-hidden={!showText}
                >
                  {showText ? text : ''}
                </span>
              );
            })}
          </div>

          {/* Weekday rows (Sunday first) */}
          {weekdays.map((w) => {
            const dayName = dayLabels[w] ?? `Day ${w}`;
            return (
              <div key={w} className="sk-heatmap-row" role="row">
                <span className="sk-heatmap-day-label sk-muted sk-body-xs" title={dayName}>
                  {dayName}
                </span>
                {hours.map((h) => {
                  const cell = cellMap.get(`${w}-${h}`) ?? {
                    weekday: w,
                    hour: h,
                    count: 0,
                    valueText: '0.00 DZD',
                  };
                  const cls = heatClass(cell.count, maxCount);
                  const label = cellLabel(cell);

                  return (
                    <div
                      key={h}
                      role="img"
                      tabIndex={0}
                      aria-label={label}
                      className={`sk-heatmap-cell sk-heatmap-cell--${cls}`}
                      style={{
                        backgroundColor:
                          cls === 0
                            ? 'var(--sk-surface-soft)'
                            : `var(--sk-chart-heat-${cls})`,
                      }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setActiveCell({ cell, x: rect.left + rect.width / 2, y: rect.top });
                      }}
                      onMouseLeave={() => setActiveCell(null)}
                      onFocus={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setActiveCell({ cell, x: rect.left + rect.width / 2, y: rect.top });
                      }}
                      onBlur={() => setActiveCell(null)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating active tooltip */}
      {activeCell && (
        <div
          role="tooltip"
          className="sk-heatmap-tooltip"
          style={{
            position: 'fixed',
            left: `${activeCell.x}px`,
            top: `${activeCell.y - 8}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          {cellLabel(activeCell.cell)}
        </div>
      )}

      {/* Heatmap legend */}
      <div className="sk-heatmap-legend" aria-hidden="true">
        <div className="sk-heatmap-legend__none">
          <span className="sk-heatmap-cell sk-heatmap-cell--0" />
          <span className="sk-muted sk-body-xs">{legend.none}</span>
        </div>

        <div className="sk-heatmap-legend__ramp">
          <span className="sk-muted sk-body-xs">{legend.fewer}</span>
          {[1, 2, 3, 4, 5].map((level) => (
            <span
              key={level}
              className={`sk-heatmap-cell sk-heatmap-cell--${level}`}
              style={{ backgroundColor: `var(--sk-chart-heat-${level})` }}
            />
          ))}
          <span className="sk-muted sk-body-xs">{legend.more}</span>
        </div>
      </div>
    </div>
  );
}
