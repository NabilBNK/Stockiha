import type { Locale } from '../../shared/i18n';

export interface RankingItem {
  label: string;
  value: number;
  secondaryValue?: number;
  sublabel?: string;
  benefit?: number;
}

interface Props {
  title: string;
  items: RankingItem[];
  locale: Locale;
  tone?: 'emerald' | 'blue' | 'purple' | 'amber';
  valueLabel?: string;
}

export function HistoricalRankingChart({
  title,
  items,
  locale,
  tone = 'emerald',
  valueLabel,
}: Props) {
  if (!items || items.length === 0) {
    return (
      <div className="sk-chart-card">
        <h4 className="sk-chart-card__title">{title}</h4>
        <div className="sk-chart-empty">{locale === 'ar' ? 'لا تتوفر بيانات' : 'No data available'}</div>
      </div>
    );
  }

  const maxVal = Math.max(1, ...items.map((i) => i.value));
  const formatMoney = (val: number) => `${new Intl.NumberFormat(locale).format(val)} DZD`;

  const barColorMap = {
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    amber: 'bg-amber-500',
  };

  return (
    <div className="sk-chart-card" data-testid="ranking-chart">
      <div className="sk-chart-card__header">
        <h4 className="sk-chart-card__title">{title}</h4>
        {valueLabel && <span className="text-xs text-muted">{valueLabel}</span>}
      </div>

      <div className="sk-ranking-list">
        {items.slice(0, 10).map((item, idx) => {
          const widthPct = Math.min(100, Math.max(4, (item.value / maxVal) * 100));

          return (
            <div key={`${item.label}-${idx}`} className="sk-ranking-item">
              <div className="sk-ranking-item__info">
                <span className="sk-ranking-item__rank">{idx + 1}</span>
                <span className="sk-ranking-item__label" title={item.label}>
                  {item.label}
                </span>
                {item.sublabel && (
                  <span className="sk-ranking-item__sublabel">({item.sublabel})</span>
                )}
              </div>

              <div className="sk-ranking-item__bar-container">
                <div
                  className={`sk-ranking-item__bar ${barColorMap[tone]}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>

              <div className="sk-ranking-item__metrics">
                <strong className="sk-ranking-item__value">{formatMoney(item.value)}</strong>
                {item.benefit !== undefined && item.benefit > 0 && (
                  <span className="sk-ranking-item__benefit text-emerald-600 font-medium">
                    +{formatMoney(item.benefit)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
