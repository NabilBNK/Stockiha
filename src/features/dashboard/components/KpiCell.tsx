import { type ReactNode } from 'react';
import { splitAmount } from '../dashboardFormat';

interface KpiCellProps {
  label: string;
  rawValue?: string | number | null;
  isMoney?: boolean;
  valueTone?: 'normal' | 'warn' | 'danger';
  subtitle1?: ReactNode;
  subtitle2?: ReactNode;
  subtitleAria?: string;
  loading?: boolean;
  refreshing?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  children?: ReactNode;
}

export function KpiCell({
  label,
  rawValue,
  isMoney = false,
  valueTone = 'normal',
  subtitle1,
  subtitle2,
  subtitleAria,
  loading = false,
  refreshing = false,
  onClick,
  ariaLabel,
  children,
}: KpiCellProps) {
  if (loading) {
    return (
      <div className="sk-dash-kpi sk-dash-kpi--loading">
        <div className="sk-dash-kpi__label">{label}</div>
        <div className="sk-dash-skeleton sk-dash-skeleton--val" />
        <div className="sk-dash-skeleton sk-dash-skeleton--sub" />
        <div className="sk-dash-skeleton sk-dash-skeleton--sub" />
      </div>
    );
  }

  let renderedValue: ReactNode = null;
  let textValue = '';

  if (children) {
    renderedValue = children;
  } else if (isMoney) {
    const { sign, integer, fraction } = splitAmount(
      rawValue !== undefined && rawValue !== null ? String(rawValue) : '0',
    );
    textValue = `${sign}${integer}${fraction} DZD`;
    renderedValue = (
      <span className="sk-dash-kpi__money">
        <span className="sk-dash-kpi__int">{sign}{integer}</span>
        <span className="sk-dash-kpi__frac">{fraction} DZD</span>
      </span>
    );
  } else {
    textValue = rawValue !== undefined && rawValue !== null ? String(rawValue) : '—';
    renderedValue = <span className="sk-dash-kpi__num">{textValue}</span>;
  }

  const toneClass =
    valueTone === 'danger'
      ? 'sk-dash-kpi__value--danger'
      : valueTone === 'warn'
        ? 'sk-dash-kpi__value--warn'
        : '';

  const fullAriaLabel =
    ariaLabel ||
    `${label}: ${textValue}${subtitleAria ? `. ${subtitleAria}` : ''}`;

  const content = (
    <>
      <div className="sk-dash-kpi__label">{label}</div>
      <div className={`sk-dash-kpi__value ${toneClass}`}>
        {renderedValue}
      </div>
      <div className="sk-dash-kpi__sub sk-dash-kpi__sub--1">
        {subtitle1 ?? <span className="sk-dash-kpi__spacer">&nbsp;</span>}
      </div>
      <div className="sk-dash-kpi__sub sk-dash-kpi__sub--2">
        {subtitle2 ?? <span className="sk-dash-kpi__spacer">&nbsp;</span>}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="sk-dash-kpi sk-dash-kpi--button"
        onClick={onClick}
        aria-label={fullAriaLabel}
        data-refreshing={refreshing}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="sk-dash-kpi"
      data-refreshing={refreshing}
      aria-label={fullAriaLabel}
    >
      {content}
    </div>
  );
}
