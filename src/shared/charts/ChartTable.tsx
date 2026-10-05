import type { ReactNode } from 'react';

export interface ChartTableColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

interface ChartTableProps {
  caption: string;
  columns: ChartTableColumn[];
  rows: Record<string, ReactNode>[];
}

export function ChartTable({ caption, columns, rows }: ChartTableProps) {
  return (
    <div className="sk-chart-table-wrap">
      <table className="sk-table sk-chart-table">
        <caption className="sk-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? 'sk-text-end' : 'sk-text-start'}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="sk-text-center sk-muted">
                —
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.numeric ? 'sk-text-end sk-tnum' : 'sk-text-start'}
                  >
                    {row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
