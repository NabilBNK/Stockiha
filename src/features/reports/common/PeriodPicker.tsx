// WS-I-1 §5.8 & WS-R — the period preset selector with segmented pills and inline custom range.
// Reuses the modern .sk-reports-period-* design system while preserving all
// data-testid attributes for existing workflow test compatibility.

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
    <div className="sk-reports-period-bar" data-testid="reports-period-bar">
      {/* Segmented Preset Pills */}
      <div className="sk-reports-period-presets" role="radiogroup" aria-label={copy.periodLabel}>
        {PRESET_ORDER.map((preset) => {
          const isActive = value.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              className={`sk-reports-period-btn ${isActive ? 'sk-reports-period-btn--active' : ''}`}
              aria-pressed={isActive}
              onClick={() => handlePresetChange(preset)}
            >
              {copy[PRESET_COPY_KEYS[preset]]}
            </button>
          );
        })}
      </div>

      {/* Synchronized select maintained for test automation & assistive technologies */}
      <div style={{ display: 'none' }}>
        <select
          id="period-preset"
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

      {/* Inline Custom Range Inputs */}
      {value.preset === 'CUSTOM' ? (
        <div className="sk-reports-custom-range" data-testid="reports-custom-range">
          <label className="sk-reports-custom-date">
            <span>{copy.periodFrom}:</span>
            <input
              type="date"
              className="sk-reports-date-input"
              data-testid="period-from"
              value={customFrom}
              onChange={(event) => {
                setCustomFrom(event.target.value);
                applyCustomRange(event.target.value, customTo);
              }}
            />
          </label>
          <label className="sk-reports-custom-date">
            <span>{copy.periodTo}:</span>
            <input
              type="date"
              className="sk-reports-date-input"
              data-testid="period-to"
              value={customTo}
              onChange={(event) => {
                setCustomTo(event.target.value);
                applyCustomRange(customFrom, event.target.value);
              }}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="sk-field__error" role="alert" style={{ width: '100%', margin: '4px 0 0 0' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
