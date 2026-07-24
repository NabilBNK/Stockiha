import React from 'react';
import { useTranslation } from '@/shared/i18n';

interface ZeroQuantityWarningProps {
  variantName: string;
  hasUsableWAC: boolean;
}

/**
 * S2-003: Warns users when attempting positive adjustments on items with zero quantity
 * and no usable WAC (weighted-average cost) to fall back on.
 */
export const ZeroQuantityWarning: React.FC<ZeroQuantityWarningProps> = ({
  variantName,
  hasUsableWAC,
}) => {
  const { t } = useTranslation();

  if (hasUsableWAC) {
    return null;
  }

  return (
    <div className="alert alert-warning" role="alert">
      <strong>{t('inventory.zeroQtyWarning.title')}</strong>
      <p>
        {t('inventory.zeroQtyWarning.message', {
          defaultValue: `"${variantName}" has zero confirmed stock and no prior weighted-average cost on record. A positive adjustment requires an approved cost basis.`,
          values: { variant: variantName },
        })}
      </p>
    </div>
  );
};
