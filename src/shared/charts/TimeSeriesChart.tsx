import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { Locale } from '../i18n';
import { compactTick, toPlotNumber } from './chartFormat';
import { SeriesTooltip, type SeriesDefinition, type SeriesTooltipProps } from './SeriesTooltip';

export interface SeriesPoint {
  key: string;
  label: string;
  values: Record<string, string>;
}

export interface TimeSeriesChartProps {
  rows: SeriesPoint[];
  series: SeriesDefinition[];
  formatValue: (value: string | null | undefined) => string;
  locale: Locale;
}

export function TimeSeriesChart({
  rows,
  series,
  formatValue,
  locale,
}: TimeSeriesChartProps) {
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
        <LineChart data={plotRows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
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
          {series.map((s) => (
            <Line
              key={s.dataKey}
              type="linear"
              dataKey={`${s.dataKey}__n`}
              stroke={`var(${s.token})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--sk-surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
          <Tooltip
            cursor={{ stroke: 'var(--sk-chart-axis)', strokeWidth: 1 }}
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
