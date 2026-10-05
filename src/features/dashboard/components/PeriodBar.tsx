import { useState, type FormEvent } from 'react';
import { Button, TextField } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import { currentBusinessDate } from '../../../shared/utils/businessDate';
import type { DashboardPeriod } from '../../../shared/ipc/dashboardDto';
import type { DashboardPrefs, PeriodKind } from '../dashboardPrefs';
import { formatRange, formatCutTime } from '../dashboardFormat';
import type { SectionState } from '../useDashboardData';

interface PeriodBarProps {
  prefs: DashboardPrefs;
  period: SectionState<DashboardPeriod>;
  updatedAt: string | null;
  isAnyRefreshing: boolean;
  onChangePeriod: (next: {
    period: PeriodKind;
    customFrom?: string | null;
    customTo?: string | null;
  }) => void;
  onRefresh: () => void;
  onToggleCompare: () => void;
}

const PERIOD_KEYS: { id: PeriodKind; labelKey: 'dash.period.today' | 'dash.period.week' | 'dash.period.month' | 'dash.period.year' | 'dash.period.custom' }[] = [
  { id: 'today', labelKey: 'dash.period.today' },
  { id: 'week', labelKey: 'dash.period.week' },
  { id: 'month', labelKey: 'dash.period.month' },
  { id: 'year', labelKey: 'dash.period.year' },
  { id: 'custom', labelKey: 'dash.period.custom' },
];

export function PeriodBar({
  prefs,
  period,
  updatedAt,
  isAnyRefreshing,
  onChangePeriod,
  onRefresh,
  onToggleCompare,
}: PeriodBarProps) {
  const { t, locale } = useI18n();
  const [selectedKind, setSelectedKind] = useState<PeriodKind>(prefs.period);
  const [fromInput, setFromInput] = useState<string>(prefs.customFrom || '');
  const [toInput, setToInput] = useState<string>(prefs.customTo || '');
  const [customError, setCustomError] = useState<string | null>(null);

  const todayStr = period.data?.today || currentBusinessDate();

  const handlePeriodClick = (kind: PeriodKind) => {
    setSelectedKind(kind);
    if (kind !== 'custom') {
      setCustomError(null);
      onChangePeriod({ period: kind });
    }
  };

  const handleApplyCustom = (e?: FormEvent) => {
    e?.preventDefault();
    const from = fromInput.trim();
    const to = toInput.trim();

    if (!from || !to) {
      setCustomError(t('dash.period.error.missing'));
      return;
    }
    if (from > to) {
      setCustomError(t('dash.period.error.order'));
      return;
    }
    if (to > todayStr) {
      setCustomError(t('dash.period.error.future'));
      return;
    }
    if (from < '2000-01-01') {
      setCustomError(t('dash.period.error.tooOld'));
      return;
    }

    setCustomError(null);
    onChangePeriod({ period: 'custom', customFrom: from, customTo: to });
  };

  // Range description line
  let rangeLine = '';
  if (period.data) {
    const curRange = formatRange(period.data.cur_from, period.data.cur_to, locale, t);
    if (prefs.compare && period.data.prev_from && period.data.prev_to) {
      const prevRange = formatRange(period.data.prev_from, period.data.prev_to, locale, t);
      rangeLine = t('dash.period.rangeCompared', { range: curRange, prevRange });
      const cut = formatCutTime(period.data.cut_time);
      if (cut) {
        rangeLine += ` ${t('dash.period.cutNote', { time: cut })}`;
      }
    } else {
      rangeLine = curRange;
    }
  }

  return (
    <header className="sk-dash__context-bar">
      <div className="sk-dash__title-row">
        <h1 className="sk-dash__heading">{t('dashboard.title')}</h1>
      </div>

      <div className="sk-dash__controls">
        <div
          role="group"
          aria-label={t('dash.period.label')}
          className="sk-dash__period-group"
        >
          {PERIOD_KEYS.map(({ id, labelKey }) => {
            const isSelected = selectedKind === id;
            return (
              <button
                key={id}
                type="button"
                className={`sk-btn sk-btn--period ${isSelected ? 'sk-btn--period-active' : ''}`}
                aria-pressed={isSelected}
                onClick={() => handlePeriodClick(id)}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {selectedKind === 'custom' && (
          <form className="sk-dash__custom-inputs" onSubmit={handleApplyCustom}>
            <div className="sk-dash__custom-fields">
              <TextField
                label={t('dash.period.from')}
                type="date"
                min="2000-01-01"
                max={todayStr}
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
              />
              <TextField
                label={t('dash.period.to')}
                type="date"
                min="2000-01-01"
                max={todayStr}
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                className="sk-dash__apply-btn"
                onClick={handleApplyCustom}
              >
                {t('dash.period.apply')}
              </Button>
            </div>
            {customError && (
              <p className="sk-field__error" role="alert">
                {customError}
              </p>
            )}
          </form>
        )}

        <label className="sk-dash__compare-toggle">
          <input
            type="checkbox"
            checked={prefs.compare}
            onChange={onToggleCompare}
          />
          <span>{t('dash.compare')}</span>
        </label>

        {updatedAt && (
          <span className="sk-dash__updated-at">
            {t('dash.updatedAt', { time: updatedAt })}
          </span>
        )}

        <Button
          type="button"
          variant="secondary"
          loading={isAnyRefreshing}
          onClick={onRefresh}
          className="sk-dash__refresh-btn"
          aria-label="Refresh"
        >
          ↻
        </Button>
      </div>

      <div className="sk-dash__range-line" aria-live="polite">
        {rangeLine}
      </div>
    </header>
  );
}
