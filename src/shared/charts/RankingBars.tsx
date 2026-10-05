import { toPlotNumber } from './chartFormat';

export interface RankingBarRow {
  key: string;
  label: string;
  sublabel?: string | null;
  value: string;
  valueText: string;
  token?: string;
}

export interface RankingBarsProps {
  rows: RankingBarRow[];
  defaultToken: string;
}

export function RankingBars({ rows, defaultToken }: RankingBarsProps) {
  // Find maximum numeric value across rows for proportional width calculation
  const numericValues = rows.map((r) => Math.max(0, toPlotNumber(r.value)));
  const max = Math.max(...numericValues, 0);

  return (
    <div className="sk-ranking-bars" role="list">
      {rows.map((row) => {
        const num = Math.max(0, toPlotNumber(row.value));
        const pct = max > 0 ? (num / max) * 100 : 0;
        const token = row.token ?? defaultToken;

        return (
          <div key={row.key} className="sk-ranking-bars__row" role="listitem">
            <div className="sk-ranking-bars__label-group">
              <span className="sk-ranking-bars__label" title={row.label}>
                {row.label}
              </span>
              {row.sublabel && (
                <span className="sk-ranking-bars__sublabel sk-muted">
                  {row.sublabel}
                </span>
              )}
            </div>

            <div className="sk-ranking-bars__track" aria-hidden="true">
              <div
                className="sk-ranking-bars__fill"
                style={{
                  width: `${pct}%`,
                  minWidth: num > 0 ? '2px' : '0',
                  backgroundColor: `var(${token})`,
                }}
              />
            </div>

            <div className="sk-ranking-bars__value sk-tnum">{row.valueText}</div>
          </div>
        );
      })}
    </div>
  );
}
