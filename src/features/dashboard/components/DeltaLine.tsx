import { useI18n } from '../../../shared/i18n';
import type { DeltaKind } from '../../../shared/ipc/dashboardDto';
import { deltaText } from '../dashboardFormat';

interface DeltaLineProps {
  kind: DeltaKind;
  pct: string | null;
  prevAmountText?: string;
  prevRange?: string;
  compare: boolean;
}

export function DeltaLine({
  kind,
  pct,
  prevAmountText = '',
  prevRange = '',
  compare,
}: DeltaLineProps) {
  const { t } = useI18n();

  if (!compare || kind === 'NONE') {
    return null;
  }

  const text = deltaText(kind, pct, prevAmountText, t);
  if (!text) {
    return null;
  }

  let colorClass = 'sk-dash-delta--muted';
  if (kind === 'UP') colorClass = 'sk-dash-delta--up';
  else if (kind === 'DOWN') colorClass = 'sk-dash-delta--down';

  const tooltip =
    prevRange && prevAmountText
      ? t('dash.delta.previous', { value: prevAmountText, range: prevRange })
      : undefined;

  return (
    <span
      className={`sk-dash-delta ${colorClass}`}
      title={tooltip}
    >
      {text}
    </span>
  );
}
