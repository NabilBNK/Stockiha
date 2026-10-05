export interface LegendItem {
  label: string;
  token: string;
  mark: 'line' | 'rect';
}

interface ChartLegendProps {
  items?: LegendItem[];
}

export function ChartLegend({ items }: ChartLegendProps) {
  if (!items || items.length < 2) return null;

  return (
    <div className="sk-chart-legend" aria-hidden="true">
      {items.map((item) => (
        <span key={item.label} className="sk-chart-legend__item">
          <span
            className={`sk-chart-legend__mark sk-chart-legend__mark--${item.mark}`}
            style={{ backgroundColor: `var(${item.token})` }}
          />
          <span className="sk-chart-legend__label">{item.label}</span>
        </span>
      ))}
    </div>
  );
}
