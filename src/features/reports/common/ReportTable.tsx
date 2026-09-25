// WS-I-1 §5.8 — a plain, printable data table shared by every report screen.

import type { ReactNode } from 'react';

import { Button } from '../../../shared/components';

// `T extends object` (not `Record<string, unknown>`) deliberately: the
// report DTOs are plain `interface`s with no index signature, and TS does
// not consider those structurally assignable to an indexed type even when
// every field matches. Keeping the constraint loose here lets every typed
// DTO row array pass straight through; the index access inside is cast
// once, locally, instead of at every call site.
export interface ReportTableColumn<T extends object = Record<string, unknown>> {
  key: string;
  label: string;
  align: 'start' | 'end' | 'center';
  render?: (row: T) => ReactNode;
}

export interface ReportTablePage {
  offset: number;
  limit: number;
  total: number;
  onPage: (offset: number) => void;
}

export interface ReportTableSort {
  key: string;
  onSort: (key: string) => void;
}

export interface ReportTableProps<T extends object = Record<string, unknown>> {
  columns: Array<ReportTableColumn<T>>;
  rows: T[];
  totals?: Record<string, ReactNode>;
  page?: ReportTablePage;
  sort?: ReportTableSort;
  testId: string;
}

export function ReportTable<T extends object = Record<string, unknown>>({
  columns,
  rows,
  totals,
  page,
  sort,
  testId,
}: ReportTableProps<T>) {
  return (
    <div className="sk-report-table">
      <table className="sk-table" data-testid={testId}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{ textAlign: column.align }}
                onClick={sort ? () => sort.onSort(column.key) : undefined}
                className={sort ? 'sk-table__sortable' : undefined}
              >
                {column.label}
                {sort?.key === column.key ? ' ▾' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align }}>
                  {column.render
                    ? column.render(row)
                    : String((row as Record<string, unknown>)[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals ? (
          <tfoot>
            <tr>
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align }}>
                  {totals[column.key] ?? ''}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {page ? (
        <div className="sk-report-table__pagination">
          <span>
            Showing {page.total === 0 ? 0 : page.offset + 1}–
            {Math.min(page.offset + page.limit, page.total)} of {page.total}
          </span>
          <Button
            type="button"
            variant="secondary"
            data-testid={`${testId}-prev`}
            disabled={page.offset <= 0}
            onClick={() => page.onPage(Math.max(0, page.offset - page.limit))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-testid={`${testId}-next`}
            disabled={page.offset + page.limit >= page.total}
            onClick={() => page.onPage(page.offset + page.limit)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
