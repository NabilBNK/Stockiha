// WS-I-1 §5.8 — the period preset selector, with a custom-range fallback.
// Reuses the existing .sk-reports-filter-* system (src/styles/global.css,
// already used by the Documents report filters) instead of unstyled markup.

import { useState } from 'react';

import { presetPeriod, type Period, type PresetId } from './periods';
import { useReportCopy } from './reportCopy';

const PRESET_COPY_KEYS: Record<PresetId, string> = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  THIS_WEEK: 'thisWeek',
  LAST_WEEK: 'lastWeek',
  THIS_MONTH: 'thisMonth',
  LAST_MONTH: 'lastMonth',
  THIS_YEAR: 'thisYear',
  CUSTOM: 'custom',
};

const PRESET_ORDER: PresetId[] = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'LAST_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_YEAR',
  'CUSTOM',
];

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const copy = useReportCopy();
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to);
  const [error, setError] = useState<string | null>(null);

  function handlePresetChange(preset: PresetId) {
    setError(null);
    if (preset === 'CUSTOM') {
      setCustomFrom(value.from);
      setCustomTo(value.to);
      onChange({ from: value.from, to: value.to, preset: 'CUSTOM' });
      return;
    }
    onChange(presetPeriod(preset));
  }

  function applyCustomRange(from: string, to: string) {
    if (from > to) {
      setError(copy.invalidRange);
      return;
    }
    setError(null);
    onChange({ from, to, preset: 'CUSTOM' });
  }

  return (
    <div className="sk-reports-filter-card sk-reports-filter-card--compact">
      <div className="sk-reports-filter-grid">
        <div className={`sk-reports-filter-cell sk-reports-filter-cell--col-3${value.preset === 'CUSTOM' ? '' : ' sk-reports-filter-cell--col-12'}`}>
          <label className="sk-reports-filter-label" htmlFor="period-preset">
            {copy.periodLabel}
          </label>
          <select
            id="period-preset"
            className="sk-field__input"
            data-testid="period-preset"
            value={value.preset}
            onChange={(event) => handlePresetChange(event.target.value as PresetId)}
          >
            {PRESET_ORDER.map((preset) => (
              <option key={preset} value={preset}>
                {copy[PRESET_COPY_KEYS[preset]]}
              </option>
            ))}
          </select>
        </div>
        {value.preset === 'CUSTOM' ? (
          <>
            <div className="sk-reports-filter-cell sk-reports-filter-cell--col-3">
              <span className="sk-reports-filter-label">{copy.periodFrom}</span>
              <input
                type="date"
                className="sk-field__input"
                data-testid="period-from"
                value={customFrom}
                onChange={(event) => {
                  setCustomFrom(event.target.value);
                  applyCustomRange(event.target.value, customTo);
                }}
              />
            </div>
            <div className="sk-reports-filter-cell sk-reports-filter-cell--col-3">
              <span className="sk-reports-filter-label">{copy.periodTo}</span>
              <input
                type="date"
                className="sk-field__input"
                data-testid="period-to"
                value={customTo}
                onChange={(event) => {
                  setCustomTo(event.target.value);
                  applyCustomRange(customFrom, event.target.value);
                }}
              />
            </div>
          </>
        ) : null}
      </div>
      {error ? (
        <p className="sk-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
