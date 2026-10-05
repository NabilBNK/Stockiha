export interface SeriesDefinition {
  dataKey: string;
  label: string;
  token: string;
}

export interface SeriesTooltipProps {
  active?: boolean;
  payload?: readonly {
    payload: {
      key: string;
      label: string;
      values: Record<string, string>;
    };
  }[];
  series: SeriesDefinition[];
  formatValue: (value: string | null | undefined) => string;
}

export function SeriesTooltip({
  active,
  payload,
  series,
  formatValue,
}: SeriesTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const row = payload[0]?.payload;
  if (!row || !row.values) return null;

  return (
    <div className="sk-series-tooltip" role="tooltip">
      <div className="sk-series-tooltip__header sk-muted">{row.label}</div>
      <div className="sk-series-tooltip__list">
        {series.map((s) => {
          const rawVal = row.values[s.dataKey];
          const formattedVal = formatValue(rawVal);
          return (
            <div key={s.dataKey} className="sk-series-tooltip__row">
              <span
                className="sk-series-tooltip__swatch"
                style={{ backgroundColor: `var(${s.token})` }}
                aria-hidden="true"
              />
              <span className="sk-series-tooltip__value">{formattedVal}</span>
              <span className="sk-series-tooltip__label">{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
