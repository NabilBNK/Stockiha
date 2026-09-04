/**
 * WS-D-8a — a variant as an inline, expandable table row.
 *
 * RULING 4 (hard): zero nested modals. Everything a variant needs — its own
 * fields, its attribute assignment, its barcodes — renders inline inside the
 * expanded row. The old isEditingVariantModal / isAddingVariantModal layers
 * are gone.
 *
 * RULING 2: every field commits on blur (or Enter), one backend call each.
 * RULING 3: deactivation and barcode removal stay explicit and confirmed.
 *
 * THE OVERWRITE TRAP. catalog.update_variant assigns name_override,
 * sale_price, is_active and minimum_stock unconditionally
 * (`minimum_stock = coalesce(p_minimum_stock, 0)`). A field-level commit must
 * therefore carry the CURRENT server value of every other column, which is
 * what commitVariant() below assembles from the freshest VariantDetail
 * snapshot. Commits are serialised per variant so an in-flight refresh can
 * never make a later commit send a stale sibling column.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { Banner, Button, ConfirmDialog } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { AttributeDefinition, VariantDetail } from '../../shared/ipc/dto';
import { AutosaveTextField } from './AutosaveFields';
import { BarcodeManager } from './BarcodeManager';
import { AttributeManagerForVariant } from './ProductEditor';
import type { CatalogController } from './useCatalog';
import { useAutosaveField } from './useAutosaveField';

/** Same shapes VariantForm validates against — exact decimal strings only. */
const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const MIN_STOCK_RE = /^\d+(?:\.\d+)?$/;

interface VariantPatch {
  nameOverride?: string | null;
  salePrice?: string;
  isActive?: boolean;
  minimumStock?: string;
}

export const VARIANT_TABLE_COLUMNS = 6;

export function VariantRow({
  catalog,
  productId,
  variant,
  attributes,
  refLoading,
  expanded,
  onToggle,
}: {
  catalog: CatalogController;
  productId: number;
  variant: VariantDetail;
  attributes: AttributeDefinition[];
  refLoading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  // Freshest server snapshot at execution time, not at closure time.
  const variantRef = useRef(variant);
  variantRef.current = variant;
  const chain = useRef<Promise<void>>(Promise.resolve());

  const commitVariant = useCallback(
    (patch: VariantPatch) => {
      const run = chain.current.catch(() => {}).then(async () => {
        const v = variantRef.current;
        await catalog.updateVariantV2(
          v.variant_id,
          patch.nameOverride !== undefined ? patch.nameOverride : v.name_override,
          patch.salePrice !== undefined ? patch.salePrice : v.sale_price,
          patch.isActive !== undefined ? patch.isActive : v.is_active,
          patch.minimumStock !== undefined ? patch.minimumStock : v.minimum_stock,
        );
        await catalog.refreshDetail(productId);
      });
      chain.current = run.catch(() => {});
      return run;
    },
    [catalog, productId],
  );

  const nameField = useAutosaveField({
    serverValue: variant.name_override ?? '',
    label: t('variants.name'),
    normalize: (v) => v.trim(),
    commit: (v) => commitVariant({ nameOverride: v || null }),
  });

  const priceField = useAutosaveField({
    serverValue: variant.sale_price,
    label: t('variants.price'),
    normalize: (v) => v.trim(),
    validate: (v) => (PRICE_RE.test(v) ? null : t('variants.invalidPrice')),
    commit: (v) => commitVariant({ salePrice: v }),
  });

  const minimumStockField = useAutosaveField({
    serverValue: variant.minimum_stock,
    label: t('variants.minimumStock'),
    normalize: (v) => v.trim(),
    validate: (v) => (MIN_STOCK_RE.test(v) ? null : t('variants.invalidMinimumStock')),
    commit: (v) => commitVariant({ minimumStock: v }),
  });

  const attributeSummary = useMemo(
    () => variant.attributes.map((a) => `${a.attribute_name}: ${a.value}`).join(', ') || '—',
    [variant.attributes],
  );

  async function applyActive(nextActive: boolean) {
    setTogglingActive(true);
    setRowError(null);
    try {
      // Deactivation is structural, so it uses the dedicated call rather than
      // riding along on a field commit.
      await catalog.setVariantActive(variant.variant_id, nextActive);
      await catalog.refreshDetail(productId);
      setConfirmDeactivate(false);
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setTogglingActive(false);
    }
  }

  const handleSetAttributes = useCallback(
    async (sel: Record<number, number>) => {
      const ids = Object.values(sel).filter((id) => id > 0);
      await catalog.setVariantAttributes(variant.variant_id, ids);
      await catalog.refreshDetail(productId);
    },
    [catalog, productId, variant.variant_id],
  );

  const handleAddBarcode = useCallback(
    async (barcode: string) => {
      await catalog.addVariantBarcode(variant.variant_id, barcode);
      await catalog.refreshDetail(productId);
    },
    [catalog, productId, variant.variant_id],
  );

  const handleRemoveBarcode = useCallback(
    async (barcodeId: number) => {
      await catalog.removeVariantBarcode(barcodeId);
      await catalog.refreshDetail(productId);
    },
    [catalog, productId],
  );

  const idPrefix = `variant-${variant.variant_id}`;

  return (
    <>
      <tr
        data-testid={`variant-row-${variant.variant_id}`}
        className={expanded ? 'sk-variant-row sk-variant-row--expanded' : 'sk-variant-row'}
      >
        <td><code>{variant.operational_identifier}</code></td>
        <td><strong>{variant.effective_variant_name}</strong></td>
        <td>{attributeSummary}</td>
        <td className="sk-num">{variant.sale_price}</td>
        <td>
          <span className={`sk-badge ${variant.is_active ? 'sk-badge--ok' : 'sk-badge--secondary'}`}>
            {variant.is_active ? t('catalog.active') : t('catalog.inactive')}
          </span>
        </td>
        <td>
          <div className="sk-variant-row__actions">
            <Button
              variant="secondary"
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={`${idPrefix}-panel`}
              data-testid={`edit-variant-${variant.variant_id}`}
            >
              {expanded ? t('variants.collapse') : t('variants.expand')}
            </Button>
            <Button
              variant={variant.is_active ? 'secondary' : 'primary'}
              type="button"
              loading={togglingActive}
              onClick={() => {
                if (variant.is_active) setConfirmDeactivate(true);
                else void applyActive(true);
              }}
              data-testid={`toggle-variant-${variant.variant_id}`}
            >
              {variant.is_active ? t('variants.deactivate') : t('variants.activate')}
            </Button>
          </div>

          {/* RULING 3: a stray click is cheap to make and expensive to undo,
              and there is no undo. Deactivation never autosaves. */}
          {confirmDeactivate ? (
            <ConfirmDialog
              title={t('variants.confirmDeactivateTitle')}
              body={t('variants.confirmDeactivateBody', { name: variant.effective_variant_name })}
              confirmLabel={t('variants.deactivate')}
              cancelLabel={t('common.cancel')}
              confirmVariant="danger"
              busy={togglingActive}
              onConfirm={() => void applyActive(false)}
              onCancel={() => setConfirmDeactivate(false)}
            />
          ) : null}
        </td>
      </tr>

      {expanded ? (
        <tr className="sk-variant-row__panel-row">
          <td colSpan={VARIANT_TABLE_COLUMNS} id={`${idPrefix}-panel`}>
            <div className="sk-variant-panel">
              {rowError ? <Banner tone="error">{rowError}</Banner> : null}

              <div className="sk-form__grid sk-variant-panel__fields">
                <AutosaveTextField
                  id={`${idPrefix}-name`}
                  label={t('variants.name')}
                  field={nameField}
                  placeholder={t('variants.namePlaceholder')}
                  testId={`${idPrefix}-name`}
                />
                <AutosaveTextField
                  id={`${idPrefix}-price`}
                  label={`${t('variants.price')} (DZD)`}
                  field={priceField}
                  inputMode="decimal"
                  testId={`${idPrefix}-price`}
                />
                <AutosaveTextField
                  id={`${idPrefix}-minimum-stock`}
                  label={t('variants.minimumStock')}
                  field={minimumStockField}
                  inputMode="decimal"
                  hint={t('variants.minimumStockHint')}
                  testId={`${idPrefix}-minimum-stock`}
                />
              </div>

              <div className="sk-variant-panel__section">
                <AttributeManagerForVariant
                  attributes={attributes}
                  refLoading={refLoading}
                  variant={variant}
                  onSetAttributes={handleSetAttributes}
                  onCreateAttribute={catalog.createAttribute}
                  onAddValue={catalog.addAttributeValue}
                />
              </div>

              <div className="sk-variant-panel__section">
                <BarcodeManager
                  barcodes={variant.barcodes}
                  onAdd={handleAddBarcode}
                  onRemove={handleRemoveBarcode}
                />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
