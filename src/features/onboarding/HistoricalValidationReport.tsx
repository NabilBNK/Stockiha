import { useMemo, useState } from 'react';
import type { HistoricalRowIssue, HistoricalRowIssueSeverity } from './xlsxParser';

interface Props {
  issues: HistoricalRowIssue[];
  /** True once the owner has confirmed every WARNING row. */
  warningsConfirmed?: boolean;
  onConfirmWarnings?: (confirmed: boolean) => void;
}

type Filter = 'ALL' | HistoricalRowIssueSeverity;

const SEVERITY_LABEL: Record<HistoricalRowIssueSeverity, string> = {
  ERROR: 'À corriger',
  WARNING: 'À confirmer',
  INFO: 'Pour information',
};

const SEVERITY_TONE: Record<HistoricalRowIssueSeverity, string> = {
  ERROR: 'danger',
  WARNING: 'warning',
  INFO: 'info',
};

const SEVERITY_ORDER: HistoricalRowIssueSeverity[] = ['ERROR', 'WARNING', 'INFO'];

/**
 * The per-row validation report the owner reads BEFORE anything is staged or
 * committed. Every message is plain French: no error codes, no stack traces.
 * Nothing is ever silently skipped — an ignored row still appears here.
 */
export function HistoricalValidationReport({
  issues,
  warningsConfirmed = false,
  onConfirmWarnings,
}: Props) {
  const [filter, setFilter] = useState<Filter>('ALL');

  const counts = useMemo(() => {
    const result: Record<HistoricalRowIssueSeverity, number> = {
      ERROR: 0,
      WARNING: 0,
      INFO: 0,
    };
    for (const issue of issues) result[issue.severity] += 1;
    return result;
  }, [issues]);

  const visible = useMemo(() => {
    const selected = filter === 'ALL' ? issues : issues.filter((i) => i.severity === filter);
    return [...selected].sort((left, right) => {
      const bySeverity =
        SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity);
      return bySeverity !== 0 ? bySeverity : left.row - right.row;
    });
  }, [issues, filter]);

  if (issues.length === 0) return null;

  return (
    <div className="sk-section-block" data-testid="paperbook-validation-report">
      <h3 className="sk-subsection-title">
        Rapport de vérification ligne par ligne ({issues.length})
      </h3>
      <p className="sk-muted">
        {counts.ERROR} ligne(s) à corriger avant l&apos;import, {counts.WARNING} ligne(s) à
        confirmer, {counts.INFO} remarque(s). Aucune ligne n&apos;est ignorée sans être signalée
        ici.
      </p>

      <div className="sk-filter-row" role="group" aria-label="Filtrer le rapport">
        {(['ALL', 'ERROR', 'WARNING', 'INFO'] as Filter[]).map((value) => (
          <button
            key={value}
            type="button"
            className={`sk-chip ${filter === value ? 'sk-chip--active' : ''}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === 'ALL' ? `Tout (${issues.length})` : `${SEVERITY_LABEL[value]} (${counts[value]})`}
          </button>
        ))}
      </div>

      <div className="sk-table-wrapper">
        <table className="sk-table">
          <thead>
            <tr>
              <th scope="col">Gravité</th>
              <th scope="col">Ligne</th>
              <th scope="col">Colonne</th>
              <th scope="col">Ce qui ne va pas</th>
              <th scope="col">Ce qu&apos;il faut faire</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((issue, index) => (
              <tr key={`${issue.sheet}-${issue.row}-${issue.column ?? ''}-${index}`}>
                <td>
                  <span className={`sk-badge sk-badge--${SEVERITY_TONE[issue.severity]}`}>
                    {SEVERITY_LABEL[issue.severity]}
                  </span>
                </td>
                <td className="sk-num">{issue.row}</td>
                <td>{issue.column ?? '—'}</td>
                <td>{issue.probleme}</td>
                <td>{issue.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {counts.WARNING > 0 && onConfirmWarnings && (
        <label className="sk-checkbox-row">
          <input
            type="checkbox"
            checked={warningsConfirmed}
            onChange={(event) => onConfirmWarnings(event.target.checked)}
          />
          <span>
            J&apos;ai vérifié les {counts.WARNING} ligne(s) signalées ci-dessus et je confirme
            qu&apos;elles correspondent bien au cahier.
          </span>
        </label>
      )}
    </div>
  );
}
