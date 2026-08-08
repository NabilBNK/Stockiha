import React from 'react';
import type { Locale } from '../../shared/i18n';

interface Props {
  title: string;
  value: number | null | undefined;
  locale: Locale;
  subtitle?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
  icon?: React.ReactNode;
  badgeText?: string;
}

export function HistoricalKpiCard({
  title,
  value,
  locale,
  subtitle,
  tone = 'neutral',
  icon,
  badgeText,
}: Props) {
  const formattedValue =
    value === null || value === undefined
      ? '—'
      : `${new Intl.NumberFormat(locale).format(value)} DZD`;

  const toneClassMap: Record<string, string> = {
    neutral: 'sk-kpi-card--neutral',
    success: 'sk-kpi-card--success',
    warning: 'sk-kpi-card--warning',
    danger: 'sk-kpi-card--danger',
    info: 'sk-kpi-card--info',
    primary: 'sk-kpi-card--primary',
  };

  return (
    <div className={`sk-kpi-card ${toneClassMap[tone] || ''}`}>
      <div className="sk-kpi-card__header">
        <span className="sk-kpi-card__title">{title}</span>
        {icon && <span className="sk-kpi-card__icon">{icon}</span>}
      </div>

      <div className="sk-kpi-card__body">
        <span className="sk-kpi-card__value">{formattedValue}</span>
        {badgeText && <span className="sk-kpi-card__badge">{badgeText}</span>}
      </div>

      {subtitle && <div className="sk-kpi-card__subtitle">{subtitle}</div>}
    </div>
  );
}
