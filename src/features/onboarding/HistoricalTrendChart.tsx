import { useState } from 'react';
import type { Locale } from '../../shared/i18n';
import type { HistoricalTradeAnalyticsResult } from '../../shared/ipc/onboardingDto';

interface Props {
  timeline: HistoricalTradeAnalyticsResult['timeline'];
  locale: Locale;
}

export function HistoricalTrendChart({ timeline, locale }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!timeline || timeline.length === 0) {
    return (
      <div className="sk-chart-empty">
        {locale === 'ar' ? 'لا تتوفر بيانات سفلية للفترة المحددة' : 'No monthly timeline data available'}
      </div>
    );
  }

  const formatMoney = (val: number) => `${new Intl.NumberFormat(locale).format(val)} DZD`;

  // Find max value across all series for height normalization
  const maxVal = Math.max(
    1,
    ...timeline.flatMap((t) => [t.salesDzd, t.purchasesDzd, t.expensesDzd, t.manualBenefitDzd ?? 0]),
  );

  const chartHeight = 220;
  const barGap = 4;
  const groupWidth = 60;
  const barWidth = 11;
  const paddingLeft = 40;
  const paddingBottom = 30;
  const svgWidth = Math.max(600, paddingLeft + timeline.length * groupWidth + 20);

  return (
    <div className="sk-chart-card">
      <div className="sk-chart-card__header">
        <h3 className="sk-chart-card__title">
          {locale === 'ar'
            ? 'تطور المبيعات والمشتريات والمصاريف والفائدة حسب الشهر'
            : locale === 'fr'
              ? 'Évolution mensuelle (Ventes, Achats, Dépenses, Bénéfice)'
              : 'Monthly Trade Trend (Sales, Purchases, Expenses, Benefit)'}
        </h3>
        <div className="sk-chart-legend">
          <span className="sk-chart-legend__item">
            <span className="sk-chart-legend__dot bg-emerald-500" />
            {locale === 'ar' ? 'المبيعات' : 'Sales'}
          </span>
          <span className="sk-chart-legend__item">
            <span className="sk-chart-legend__dot bg-blue-500" />
            {locale === 'ar' ? 'المشتريات' : 'Purchases'}
          </span>
          <span className="sk-chart-legend__item">
            <span className="sk-chart-legend__dot bg-amber-500" />
            {locale === 'ar' ? 'المصاريف' : 'Expenses'}
          </span>
          <span className="sk-chart-legend__item">
            <span className="sk-chart-legend__dot bg-purple-500" />
            {locale === 'ar' ? 'الفائدة' : 'Benefit'}
          </span>
        </div>
      </div>

      <div className="sk-chart-container">
        <svg
          viewBox={`0 0 ${svgWidth} ${chartHeight + paddingBottom}`}
          className="sk-chart-svg"
          role="img"
          aria-label={locale === 'ar' ? 'رسم المعاملات الشهرية' : locale === 'fr' ? 'Graphique mensuel des transactions' : 'Monthly trade chart'}
        >
          <title>{locale === 'ar' ? 'تطور المبيعات والمشتريات والمصاريف والفائدة' : locale === 'fr' ? 'Évolution des ventes, achats, dépenses et bénéfices' : 'Sales, purchases, expenses and benefit over time'}</title>
          {/* Y Axis Grid lines */}
          {[0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = chartHeight - ratio * chartHeight;
            const val = Math.round(ratio * maxVal);
            return (
              <g key={ratio}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - 10}
                  y2={y}
                  stroke="var(--sk-border)"
                  strokeDasharray="4 4"
                />
                <text
                  x={paddingLeft - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--sk-muted)"
                >
                  {val >= 1000 ? `${Math.round(val / 1000)}k` : val}
                </text>
              </g>
            );
          })}

          {/* Monthly Groups */}
          {timeline.map((item, idx) => {
            const groupX = paddingLeft + idx * groupWidth + 10;

            const salesH = (item.salesDzd / maxVal) * chartHeight;
            const purchH = (item.purchasesDzd / maxVal) * chartHeight;
            const expH = (item.expensesDzd / maxVal) * chartHeight;
            const benH = ((item.manualBenefitDzd ?? 0) / maxVal) * chartHeight;

            const isHovered = hoverIndex === idx;

            return (
              <g
                key={item.yearMonth ?? item.month}
                onMouseEnter={() => setHoverIndex(idx)}
                onMouseLeave={() => setHoverIndex(null)}
                className="sk-chart-group"
              >
                {/* Hover overlay background */}
                {isHovered && (
                  <rect
                    x={groupX - 4}
                    y={0}
                    width={4 * barWidth + 3 * barGap + 8}
                    height={chartHeight}
                    fill="rgba(99, 102, 241, 0.06)"
                    rx="4"
                  />
                )}

                {/* Sales Bar */}
                <rect
                  x={groupX}
                  y={chartHeight - salesH}
                  width={barWidth}
                  height={salesH}
                  fill="var(--sk-chart-sales)"
                  rx="2"
                />

                {/* Purchases Bar */}
                <rect
                  x={groupX + barWidth + barGap}
                  y={chartHeight - purchH}
                  width={barWidth}
                  height={purchH}
                  fill="var(--sk-chart-purchases)"
                  rx="2"
                />

                {/* Expenses Bar */}
                <rect
                  x={groupX + 2 * (barWidth + barGap)}
                  y={chartHeight - expH}
                  width={barWidth}
                  height={expH}
                  fill="var(--sk-chart-expenses)"
                  rx="2"
                />

                {/* Manual Benefit Bar */}
                <rect
                  x={groupX + 3 * (barWidth + barGap)}
                  y={chartHeight - benH}
                  width={barWidth}
                  height={benH}
                  fill="var(--sk-chart-benefit)"
                  rx="2"
                />

                {/* Month Label */}
                <text
                  x={groupX + 2 * (barWidth + barGap)}
                  y={chartHeight + 20}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={isHovered ? 'bold' : 'normal'}
                  fill="var(--sk-text)"
                >
                  {item.yearMonth ?? item.month}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Interactive Tooltip Card */}
      {hoverIndex !== null && timeline[hoverIndex] && (
        <div className="sk-chart-tooltip" data-testid="chart-tooltip">
          <strong>{timeline[hoverIndex].yearMonth ?? timeline[hoverIndex].month}</strong>
          <div className="sk-chart-tooltip__grid">
            <span>{locale === 'ar' ? 'المبيعات:' : locale === 'fr' ? 'Ventes :' : 'Sales:'}</span>
            <strong>{formatMoney(timeline[hoverIndex].salesDzd)}</strong>
            <span>{locale === 'ar' ? 'المشتريات:' : locale === 'fr' ? 'Achats :' : 'Purchases:'}</span>
            <strong>{formatMoney(timeline[hoverIndex].purchasesDzd)}</strong>
            <span>{locale === 'ar' ? 'المصاريف:' : locale === 'fr' ? 'Dépenses :' : 'Expenses:'}</span>
            <strong>{formatMoney(timeline[hoverIndex].expensesDzd)}</strong>
            <span>{locale === 'ar' ? 'الفائدة المسجلة:' : locale === 'fr' ? 'Bénéfice enregistré :' : 'Recorded Benefit:'}</span>
            <strong className="text-emerald-600">
              {formatMoney(timeline[hoverIndex].manualBenefitDzd ?? 0)}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}
