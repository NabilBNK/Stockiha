// WS-I-1 §5.8 — a plain, printable data table shared by every report screen.
// Reuses the existing .sk-table-container/.sk-table system (sticky header,
// zebra striping, hover) instead of a bare unstyled wrapper.

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
    <div className="sk-reports-table-block">
      <div className="sk-table-container">
        <table className="sk-table" data-testid={testId}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ textAlign: column.align }}>
                  {sort ? (
                    <button type="button" className="sk-sort-header" onClick={() => sort.onSort(column.key)}>
                      {column.label}
                      <span className={`sk-sort-header__icon${sort.key === column.key ? ' sk-sort-header__icon--active' : ''}`}>
                        ▾
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
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
      </div>
      {page ? (
        <div className="sk-table-scope sk-reports-table-pagination">
          <span>
            Showing {page.total === 0 ? 0 : page.offset + 1}–
            {Math.min(page.offset + page.limit, page.total)} of {page.total}
          </span>
          <div className="sk-action-group">
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
        </div>
      ) : null}
    </div>
  );
}
