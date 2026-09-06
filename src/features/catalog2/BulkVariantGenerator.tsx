/**
 * WS-D-8b Part 2 — bulk variant creation from an attribute grid.
 *
 * Owner context: nearly every product has variants, and creating them one at
 * a time is the slowest part of stocking new inventory. The operator picks
 * one or more values per attribute; this previews every resulting
 * combination BEFORE anything is written, lets each row be edited (or
 * excluded) individually, offers a bulk-fill for price and minimum stock, and
 * only writes anything once "Create N variants" is pressed.
 *
 * C-A — EXISTING COMBINATIONS. A variant's identity is its attribute
 * combination, and the database rejects a duplicate. Detection compares the
 * SETS of attribute_value_ids against the product's already-loaded variants
 * (`existingVariants`, from get_product_detail) — never by parsing or
 * reconstructing `attribute_signature`, which is backend-derived and
 * display-only. A flagged row is excluded by default, not sent and rejected;
 * the backend's own rejection is still handled per-row (`createRow` below),
 * because the preview check is a courtesy, not authorisation.
 *
 * C-B — CREATION IS NOT ATOMIC. Up to three calls per variant — addVariant,
 * then updateVariantV2 for minimum stock (VariantInput carries none), then
 * setVariantAttributes — with no transaction wrapping them. `runCreate`
 * therefore:
 *   - creates SEQUENTIALLY (never Promise.all), so a signature-uniqueness
 *     race against the same product can't happen and a partial failure stays
 *     legible;
 *   - tracks pending/creating/created/failed PER ROW, with the reason;
 *   - never rolls back a created row and never reports one blanket failure —
 *     "4 of 6 created; S·Red and M·Blue failed: <reason>" is the shape;
 *   - offers Retry for failed rows ONLY — a created row is never recreated;
 *   - if addVariant succeeds but updateVariantV2 or setVariantAttributes
 *     fails, that row is still 'created' (the variant exists) but carries a
 *     warning naming exactly what did not apply — the same pattern
 *     `submitAddVariant` in CatalogPanel.tsx already uses for one variant at
 *     a time.
 *
 * C-C — SCALE GUARD. `MAX_COMBINATIONS` (100) blocks generation outright;
 * `WARN_THRESHOLD` (25) only warns. Nothing here ever fetches every page to
 * sort or generate — the combinations come from the attribute VALUES picked,
 * never from the product list.
 *
 * C-D — exact decimals throughout: price and minimum stock are raw strings,
 * bulk-fill copies the string verbatim, and nothing here calls Number(),
 * parseFloat() or does arithmetic on them (catalogValidation.ts validates
 * them as strings, same as everywhere else on this page).
 *
 * C-E — barcodes are per-variant and unique, so bulk-fill deliberately has no
 * barcode field: each row's barcode stays individually typed, blank by
 * default.
 */
import { useMemo, useState } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type { AttributeDefinition, VariantDetail, VariantInput } from '../../shared/ipc/dto';
import { isValidMinimumStock, isValidPrice } from './catalogValidation';

export const MAX_COMBINATIONS = 100;
export const WARN_THRESHOLD = 25;

interface GenRow {
  key: string;
  attributeValueIds: number[];
  labels: string[];
  nameOverride: string;
  barcode: string;
  salePrice: string;
  minimumStock: string;
  include: boolean;
  existing: boolean;
  status: 'pending' | 'creating' | 'created' | 'failed';
  error?: string;
  variantId?: number;
}

interface AttrCombo {
  attributeValueIds: number[];
  labels: string[];
}

/** Cartesian product over only the attributes that have >=1 value picked. */
function buildCombinations(
  attributes: AttributeDefinition[],
  selection: Record<number, number[]>,
): AttrCombo[] {
  const active = attributes
    .map((attr) => ({
      values: attr.attribute_values.filter((v) => (selection[attr.attribute_id] ?? []).includes(v.id)),
    }))
    .filter((attr) => attr.values.length > 0);

  if (active.length === 0) return [];

  let combos: AttrCombo[] = [{ attributeValueIds: [], labels: [] }];
  for (const attr of active) {
    const next: AttrCombo[] = [];
    for (const combo of combos) {
      for (const value of attr.values) {
        next.push({
          attributeValueIds: [...combo.attributeValueIds, value.id],
          labels: [...combo.labels, value.value],
        });
      }
    }
    combos = next;
  }
  return combos;
}

/** C-A — set-equality against an existing variant's assigned attribute values. */
function existingCombinationKeys(existingVariants: VariantDetail[]): Set<string> {
  return new Set(
    existingVariants.map((v) =>
      v.attributes.map((a) => a.attribute_value_id).sort((a, b) => a - b).join(',')),
  );
}

function comboKey(attributeValueIds: number[]): string {
  return attributeValueIds.slice().sort((a, b) => a - b).join(',');
}

export function BulkVariantGenerator({
  token,
  productId,
  attributes,
  refLoading,
  existingVariants,
  onCancel,
  onCreated,
}: {
  token: string;
  productId: number;
  attributes: AttributeDefinition[];
  refLoading: boolean;
  existingVariants: VariantDetail[];
  onCancel: () => void;
  /** Called after EVERY row in a run settles, successes included. */
  onCreated: () => Promise<void>;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [phase, setPhase] = useState<'select' | 'preview'>('select');
  const [selection, setSelection] = useState<Record<number, number[]>>({});
  const [rows, setRows] = useState<GenRow[]>([]);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkMinimumStock, setBulkMinimumStock] = useState('');
  const [creating, setCreating] = useState(false);
  const [runSummary, setRunSummary] = useState<string | null>(null);

  const combinations = useMemo(() => buildCombinations(attributes, selection), [attributes, selection]);
  const overCap = combinations.length > MAX_COMBINATIONS;
  const nearCap = !overCap && combinations.length > WARN_THRESHOLD;

  function toggleValue(attributeId: number, valueId: number) {
    setSelection((prev) => {
      const current = prev[attributeId] ?? [];
      const next = current.includes(valueId)
        ? current.filter((id) => id !== valueId)
        : [...current, valueId];
      return { ...prev, [attributeId]: next };
    });
  }

  function preview() {
    if (combinations.length === 0 || overCap) return;
    const existingKeys = existingCombinationKeys(existingVariants);
    const built: GenRow[] = combinations.map((combo) => {
      const key = combo.attributeValueIds.join('-');
      const existing = existingKeys.has(comboKey(combo.attributeValueIds));
      return {
        key,
        attributeValueIds: combo.attributeValueIds,
        labels: combo.labels,
        nameOverride: '',
        barcode: '',
        salePrice: bulkPrice,
        minimumStock: bulkMinimumStock || '0',
        include: !existing,
        existing,
        status: 'pending',
      };
    });
    setRows(built);
    setRunSummary(null);
    setPhase('preview');
  }

  function backToSelect() {
    setPhase('select');
    setRunSummary(null);
  }

  function patchRow(key: string, patch: Partial<GenRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** C-D — bulk-fill copies the exact string to every INCLUDED, not-yet-created row. */
  function applyBulkPrice() {
    setRows((prev) => prev.map((r) => (r.status === 'created' ? r : { ...r, salePrice: bulkPrice })));
  }
  function applyBulkMinimumStock() {
    setRows((prev) => prev.map((r) => (r.status === 'created' ? r : { ...r, minimumStock: bulkMinimumStock })));
  }

  const includedRows = rows.filter((r) => r.include);
  const allValid = includedRows.every((r) => isValidPrice(r.salePrice) && isValidMinimumStock(r.minimumStock));
  const pendingCount = rows.filter((r) => r.include && r.status === 'pending').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const createdCount = rows.filter((r) => r.status === 'created').length;

  /**
   * C-B — one variant's up-to-three calls. addVariant failing is the only
   * outcome that leaves the row retryable; a failure in either call after it
   * still means the variant EXISTS, so the row is 'created' with a warning,
   * never 'failed'.
   */
  async function createRow(row: GenRow): Promise<GenRow> {
    let variantId: number;
    try {
      const input: VariantInput = {
        ...(row.nameOverride.trim() ? { name_override: row.nameOverride.trim() } : {}),
        sale_price: row.salePrice,
        is_active: true,
        ...(row.barcode.trim() ? { barcodes: [row.barcode.trim()] } : {}),
      };
      variantId = await ipc.addVariant(token, productId, input);
    } catch (err) {
      return { ...row, status: 'failed', error: errorText(err) };
    }

    const warnings: string[] = [];
    try {
      await ipc.updateVariantV2(token, variantId, row.nameOverride.trim() || null, row.salePrice, true, row.minimumStock);
    } catch (err) {
      warnings.push(`${t('catalog2.bulkMinimumStockFailed')} ${errorText(err)}`);
    }
    if (row.attributeValueIds.length > 0) {
      try {
        await ipc.setVariantAttributes(token, variantId, row.attributeValueIds);
      } catch (err) {
        warnings.push(`${t('catalog2.bulkAttributesFailed')} ${errorText(err)}`);
      }
    }
    return {
      ...row,
      status: 'created',
      variantId,
      error: warnings.length > 0 ? warnings.join(' ') : undefined,
    };
  }

  /** Sequential — see the C-B note above for why this must never be Promise.all. */
  async function runCreate(keys: string[]) {
    if (keys.length === 0) return;
    setCreating(true);
    setRunSummary(null);
    const working = [...rows];
    for (const key of keys) {
      const idx = working.findIndex((r) => r.key === key);
      if (idx === -1) continue;
      working[idx] = { ...working[idx], status: 'creating' };
      setRows([...working]);
      // Deliberately sequential — see the C-B note above the function.
      working[idx] = await createRow(working[idx]);
      setRows([...working]);
    }
    setCreating(false);
    const created = working.filter((r) => r.status === 'created').length;
    const failed = working.filter((r) => r.status === 'failed');
    setRunSummary(
      failed.length === 0
        ? t('catalog2.bulkAllCreated', { count: created })
        : t('catalog2.bulkPartialCreated', {
          created,
          total: created + failed.length,
          names: failed.map((r) => r.labels.join(' · ')).join(', '),
        }),
    );
    await onCreated();
  }

  function handleCreate() {
    const keys = rows.filter((r) => r.include && r.status === 'pending').map((r) => r.key);
    void runCreate(keys);
  }

  function handleRetry() {
    const keys = rows.filter((r) => r.status === 'failed').map((r) => r.key);
    void runCreate(keys);
  }

  if (refLoading) return null;

  return (
    <div className="sk-catalog2__panel-variant-body" data-testid="catalog2-bulk-generator">
      {phase === 'select' ? (
        <>
          <h3>{t('catalog2.bulkTitle')}</h3>
          <p className="sk-catalog2__note">{t('catalog2.bulkHint')}</p>

          {attributes.length === 0 ? (
            <Banner tone="info">{t('attrs.empty')}</Banner>
          ) : (
            <div className="sk-catalog2__bulk-attrs">
              {attributes.map((attr) => (
                <div key={attr.attribute_id} className="sk-catalog2__bulk-attr-row">
                  <div className="sk-attr__name">{attr.name}</div>
                  <div className="sk-catalog2__bulk-values">
                    {attr.attribute_values.map((v) => (
                      <label key={v.id} className="sk-catalog2__checkbox">
                        <input
                          type="checkbox"
                          checked={(selection[attr.attribute_id] ?? []).includes(v.id)}
                          onChange={() => toggleValue(attr.attribute_id, v.id)}
                          data-testid={`catalog2-bulk-attr-value-${attr.attribute_id}-${v.id}`}
                        />
                        <span>{v.value}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="sk-catalog2__note" data-testid="catalog2-bulk-combination-count">
            {t('catalog2.bulkCombinationCount', { count: combinations.length })}
          </p>

          {overCap ? (
            <Banner tone="error" testId="catalog2-bulk-cap-error">
              {t('catalog2.bulkTooMany', { max: MAX_COMBINATIONS })}
            </Banner>
          ) : nearCap ? (
            <Banner tone="warning" testId="catalog2-bulk-cap-warning">
              {t('catalog2.bulkManyWarning', { count: combinations.length })}
            </Banner>
          ) : null}

          <div className="sk-catalog2__actions sk-catalog2__actions--end">
            <Button type="button" variant="secondary" onClick={onCancel} data-testid="catalog2-bulk-cancel">
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={combinations.length === 0 || overCap}
              onClick={preview}
              data-testid="catalog2-bulk-preview"
            >
              {t('catalog2.bulkPreview')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3>{t('catalog2.bulkPreviewTitle')}</h3>

          {runSummary ? (
            <Banner tone={failedCount > 0 ? 'warning' : 'success'} testId="catalog2-bulk-summary">
              {runSummary}
            </Banner>
          ) : null}

          <div className="sk-catalog2__bulk-fill">
            <TextField
              id="catalog2-bulk-fill-price"
              label={`${t('catalog2.bulkFillPrice')} (DZD)`}
              value={bulkPrice}
              inputMode="decimal"
              onChange={(e) => setBulkPrice(e.target.value)}
              disabled={creating}
              data-testid="catalog2-bulk-fill-price"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!isValidPrice(bulkPrice) || creating}
              onClick={applyBulkPrice}
              data-testid="catalog2-bulk-fill-price-apply"
            >
              {t('catalog2.bulkApplyToAll')}
            </Button>
            <TextField
              id="catalog2-bulk-fill-min-stock"
              label={t('variants.minimumStock')}
              value={bulkMinimumStock}
              inputMode="decimal"
              onChange={(e) => setBulkMinimumStock(e.target.value)}
              disabled={creating}
              data-testid="catalog2-bulk-fill-min-stock"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!isValidMinimumStock(bulkMinimumStock) || creating}
              onClick={applyBulkMinimumStock}
              data-testid="catalog2-bulk-fill-min-stock-apply"
            >
              {t('catalog2.bulkApplyToAll')}
            </Button>
          </div>

          <div className="sk-catalog2__table-wrap">
            <table className="sk-catalog2__table" data-testid="catalog2-bulk-preview-table">
              <thead>
                <tr>
                  <th scope="col">{t('catalog2.bulkInclude')}</th>
                  <th scope="col">{t('attrs.selection')}</th>
                  <th scope="col">{t('variants.name')}</th>
                  <th scope="col">{t('barcodes.barcode')}</th>
                  <th scope="col" className="sk-catalog2__num">{`${t('variants.price')} (DZD)`}</th>
                  <th scope="col" className="sk-catalog2__num">{t('variants.minimumStock')}</th>
                  <th scope="col">{t('catalog2.bulkStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-testid={`catalog2-bulk-row-${row.key}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.include}
                        disabled={creating || row.status === 'created'}
                        onChange={(e) => patchRow(row.key, { include: e.target.checked })}
                        data-testid={`catalog2-bulk-row-${row.key}-include`}
                      />
                    </td>
                    <td>
                      {row.labels.join(' · ')}
                      {row.existing ? (
                        <span
                          className="sk-catalog2__pill sk-catalog2__pill--neutral"
                          data-testid={`catalog2-bulk-row-${row.key}-existing`}
                        >
                          {t('catalog2.bulkAlreadyExists')}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="sk-catalog2__input"
                        value={row.nameOverride}
                        disabled={creating || row.status === 'created'}
                        onChange={(e) => patchRow(row.key, { nameOverride: e.target.value })}
                        data-testid={`catalog2-bulk-row-${row.key}-name`}
                      />
                    </td>
                    <td>
                      <input
                        className="sk-catalog2__input"
                        value={row.barcode}
                        disabled={creating || row.status === 'created'}
                        onChange={(e) => patchRow(row.key, { barcode: e.target.value })}
                        data-testid={`catalog2-bulk-row-${row.key}-barcode`}
                      />
                    </td>
                    <td className="sk-catalog2__num">
                      <input
                        className="sk-catalog2__input"
                        inputMode="decimal"
                        value={row.salePrice}
                        disabled={creating || row.status === 'created'}
                        onChange={(e) => patchRow(row.key, { salePrice: e.target.value })}
                        data-testid={`catalog2-bulk-row-${row.key}-price`}
                      />
                    </td>
                    <td className="sk-catalog2__num">
                      <input
                        className="sk-catalog2__input"
                        inputMode="decimal"
                        value={row.minimumStock}
                        disabled={creating || row.status === 'created'}
                        onChange={(e) => patchRow(row.key, { minimumStock: e.target.value })}
                        data-testid={`catalog2-bulk-row-${row.key}-min-stock`}
                      />
                    </td>
                    <td data-testid={`catalog2-bulk-row-${row.key}-status`}>
                      {row.status === 'pending' && t('catalog2.bulkStatusPending')}
                      {row.status === 'creating' && t('catalog2.bulkStatusCreating')}
                      {row.status === 'created' && (
                        row.error
                          ? `${t('catalog2.bulkStatusCreatedWithWarning')} ${row.error}`
                          : t('catalog2.bulkStatusCreated')
                      )}
                      {row.status === 'failed' && `${t('catalog2.bulkStatusFailed')} ${row.error ?? ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="sk-catalog2__note">
            {t('catalog2.bulkCreatedSoFar', { created: createdCount, total: rows.length })}
          </p>

          <div className="sk-catalog2__actions sk-catalog2__actions--end">
            <Button type="button" variant="secondary" onClick={backToSelect} disabled={creating} data-testid="catalog2-bulk-back">
              {t('catalog2.bulkBack')}
            </Button>
            {failedCount > 0 ? (
              <Button type="button" variant="secondary" onClick={handleRetry} loading={creating} data-testid="catalog2-bulk-retry">
                {t('catalog2.bulkRetry', { count: failedCount })}
              </Button>
            ) : null}
            <Button
              type="button"
              loading={creating}
              disabled={pendingCount === 0 || !allValid || creating}
              onClick={handleCreate}
              data-testid="catalog2-bulk-create"
            >
              {t('catalog2.bulkCreateCount', { count: pendingCount })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
