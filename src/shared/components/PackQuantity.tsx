import { useContext } from 'react';
import { I18nContext } from '../i18n';
import { formatPackQuantity, compareDecimal } from '../utils/packMath';
import { formatDecimalDisplay } from '../../features/inventory/exactDecimal';
import type { PrimaryPack } from '../ipc/dto';

export interface PackQuantityProps {
  baseQuantity: string;
  baseUnitName: string;
  pack?: PrimaryPack | null;
  className?: string;
  testId?: string;
}

/**
 * Renders an on-screen stock quantity in packs ("2 Carton + 5 Unit") when the product has a main pack,
 * or plain base units ("29 Unit") when it does not.
 * Tabular numerals; shows a tooltip "= {baseQuantity} {base}" when a pack is used.
 */
export function PackQuantity({
  baseQuantity,
  baseUnitName,
  pack,
  className,
  testId,
}: PackQuantityProps): React.JSX.Element {
  const i18n = useContext(I18nContext);

  const isPackEffective = Boolean(pack && compareDecimal(pack.conversion_factor, '1') > 0);

  const formatted = isPackEffective && pack
    ? formatPackQuantity(
        baseQuantity,
        { unitName: pack.unit_name, factor: pack.conversion_factor },
        baseUnitName
      )
    : (baseUnitName
        ? `${formatDecimalDisplay(baseQuantity, i18n?.locale || 'en')} ${baseUnitName}`.trim()
        : formatDecimalDisplay(baseQuantity, i18n?.locale || 'en'));

  const tooltip = isPackEffective
    ? i18n?.t('pack.display.tooltip', { baseQuantity, base: baseUnitName }) || `= ${baseQuantity} ${baseUnitName}`
    : undefined;

  return (
    <span
      className={className}
      title={tooltip}
      style={{ fontVariantNumeric: 'tabular-nums' }}
      data-testid={testId}
    >
      {formatted}
    </span>
  );
}
