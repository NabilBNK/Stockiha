import React from 'react';
import { useI18n } from '../../shared/i18n';

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
  const { t } = useI18n();

  if (hasUsableWAC) {
    return null;
  }

  return (
    <div className="sk-banner sk-banner--warning" role="alert" data-testid="zero-qty-warning">
      <strong>{t('inventory.zeroQtyWarning.title')}</strong>
      <p>
        {t('inventory.zeroQtyWarning.message', {
          variant: variantName,
        })}
      </p>
    </div>
  );
};
