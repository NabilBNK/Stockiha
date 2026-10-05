import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { Locale } from '../i18n';
import { compactTick, toPlotNumber } from './chartFormat';
import { SeriesTooltip, type SeriesDefinition, type SeriesTooltipProps } from './SeriesTooltip';
import type { SeriesPoint } from './TimeSeriesChart';

export interface StackedColumnChartProps {
  rows: SeriesPoint[];
  series: SeriesDefinition[];
  formatValue: (value: string | null | undefined) => string;
  locale: Locale;
}

export function StackedColumnChart({
  rows,
  series,
  formatValue,
  locale,
}: StackedColumnChartProps) {
  const plotRows = rows.map((r) => {
    const item: Record<string, unknown> = {
      key: r.key,
      label: r.label,
      values: r.values,
    };
    for (const s of series) {
      item[`${s.dataKey}__n`] = toPlotNumber(r.values[s.dataKey]);
    }
    return item;
  });

  return (
    <div dir="ltr" className="sk-chart-plot-wrap">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={plotRows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--sk-chart-grid)" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--sk-muted)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--sk-chart-axis)' }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            width={64}
            tickFormatter={(v) => compactTick(v, locale)}
            tick={{ fill: 'var(--sk-muted)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            domain={[(min: number) => Math.min(0, min), 'auto']}
          />
          {series.map((s, index) => {
            const isLast = index === series.length - 1;
            return (
              <Bar
                key={s.dataKey}
                dataKey={`${s.dataKey}__n`}
                stackId="stack"
                fill={`var(${s.token})`}
                stroke="var(--sk-surface)"
                strokeWidth={1}
                maxBarSize={24}
                isAnimationActive={false}
                radius={isLast ? [4, 4, 0, 0] : undefined}
              />
            );
          })}
          <Tooltip
            cursor={{ fill: 'var(--sk-surface-hover)' }}
            isAnimationActive={false}
            content={(p) => (
              <SeriesTooltip
                active={p.active}
                payload={p.payload as unknown as SeriesTooltipProps['payload']}
                series={series}
                formatValue={formatValue}
              />
            )}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
