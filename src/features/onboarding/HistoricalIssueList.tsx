import { useState } from 'react';
import type { Locale } from '../../shared/i18n';
import type { PaperBookError } from './xlsxParser';

interface Props {
  errors: PaperBookError[];
  locale: Locale;
  isPartial?: boolean;
}

export function HistoricalIssueList({ errors, locale, isPartial = false }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (!errors || errors.length === 0) return null;

  const headerTitle =
    locale === 'ar'
      ? `تم اكتشاف ${errors.length} أخطاء في ملف Excel`
      : locale === 'fr'
        ? `${errors.length} Erreurs Détectées dans le Classeur Excel`
        : `${errors.length} Errors Found in Excel Workbook`;

  const warningSubtext = isPartial
    ? locale === 'ar'
      ? 'معاينة جزئية: الدفعة تحتوي على أخطاء يمنع الموافقة عليها قبل التصحيح'
      : locale === 'fr'
        ? 'Aperçu Partiel: Le lot contient des erreurs bloquantes'
        : 'Partial Preview: Batch contains blocking errors that prevent approval until fixed'
    : null;

  return (
    <div className="sk-issue-list sk-issue-list--error" data-testid="paperbook-errors">
      <div className="sk-issue-list__header">
        <div className="sk-issue-list__header-title">
          <svg className="sk-icon--md text-rose-500" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <strong>{headerTitle}</strong>
            {warningSubtext && <p className="sk-issue-list__subtext">{warningSubtext}</p>}
          </div>
        </div>
        <button
          type="button"
          className="sk-issue-list__toggle"
          aria-expanded={!collapsed}
          aria-label={
            locale === 'ar'
              ? collapsed ? 'إظهار الأخطاء' : 'إخفاء الأخطاء'
              : locale === 'fr'
                ? collapsed ? 'Afficher les erreurs' : 'Masquer les erreurs'
                : collapsed ? 'Show errors' : 'Hide errors'
          }
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '▼' : '▲'}
        </button>
      </div>

      {!collapsed && (
        <ul className="sk-issue-list__items">
          {errors.map((item, index) => (
            <li key={`${item.sheet}-${item.row}-${index}`} className="sk-issue-list__item">
              <div className="sk-issue-list__badge-group">
                <span className="sk-badge sk-badge--danger">{item.sheet}</span>
                {item.row > 0 && (
                  <span className="sk-badge sk-badge--neutral">
                    {locale === 'ar' ? `السطر ${item.row}` : `Row ${item.row}`}
                  </span>
                )}
              </div>
              <div className="sk-issue-list__message">{item.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
