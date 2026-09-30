import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Banner, Button, ConfirmDialog } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type MessageKey } from '../../shared/i18n';
import * as ipc from '../../shared/ipc/gateway';
import type { UnitLifecycleItem, VariantPack } from '../../shared/ipc/dto';
import { formatDisplayAmount } from '../../shared/utils/formatters';
import { compareDecimal, packRate } from '../../shared/utils/packMath';
import { formatExactDecimal } from '../inventory/exactDecimal';
import { normalizeDecimalInput, validatePackForm, type PackFormErrors } from './packValidation';

export interface PackManagerProps {
  variantId: number;
  baseUnit: {
    id: number;
    code: string;
    name: string;
    isWhole: boolean;
  };
  pieceSalePrice: string;
  units: UnitLifecycleItem[];
  sessionToken: string;
  onChanged?: () => Promise<void> | void;
  onPacksLoaded?: (packs: VariantPack[]) => void;
}

export function PackManager({
  variantId,
  baseUnit,
  pieceSalePrice,
  units,
  sessionToken,
  onChanged,
  onPacksLoaded,
}: PackManagerProps) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [packs, setPacks] = useState<VariantPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'warning'; message: string } | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<VariantPack | null>(null);
  const [dialogUnitId, setDialogUnitId] = useState<number | null>(null);
  const [dialogFactor, setDialogFactor] = useState('');
  const [dialogPrice, setDialogPrice] = useState('');
  const [dialogBarcode, setDialogBarcode] = useState('');
  const [dialogIsPrimary, setDialogIsPrimary] = useState(false);
  const [dialogErrors, setDialogErrors] = useState<PackFormErrors & { barcodeText?: string }>({});
  const [dialogSaving, setDialogSaving] = useState(false);
  const [dialogSaveError, setDialogSaveError] = useState<string | null>(null);

  // Inline Barcode addition per pack row
  const [addingBarcodeForPackId, setAddingBarcodeForPackId] = useState<number | null>(null);
  const [inlineBarcodeText, setInlineBarcodeText] = useState('');
  const [inlineBarcodeSaving, setInlineBarcodeSaving] = useState(false);
  const [inlineBarcodeError, setInlineBarcodeError] = useState<string | null>(null);

  // Confirmations
  const [confirmDeletePack, setConfirmDeletePack] = useState<VariantPack | null>(null);
  const [deletingPack, setDeletingPack] = useState(false);
  const [confirmRemoveBarcode, setConfirmRemoveBarcode] = useState<{
    barcodeId: number;
    barcode: string;
  } | null>(null);
  const [removingBarcode, setRemovingBarcode] = useState(false);
  const [confirmRemoveSmallerUnit, setConfirmRemoveSmallerUnit] = useState<VariantPack | null>(null);
  const [removingSmallerUnit, setRemovingSmallerUnit] = useState(false);

  const onPacksLoadedRef = useRef(onPacksLoaded);
  onPacksLoadedRef.current = onPacksLoaded;

  const loadPacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await ipc.listVariantPacks(sessionToken, variantId);
      setPacks(rows);
      onPacksLoadedRef.current?.(rows);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, variantId, errorText]);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  // Split into packs (is_pack = true) and smaller units (is_pack = false)
  const packRows = useMemo(() => packs.filter((p) => p.is_pack), [packs]);
  const smallerRows = useMemo(() => packs.filter((p) => !p.is_pack), [packs]);

  // Sort packs: active rows first, then inactive rows
  const sortedPackRows = useMemo(() => {
    const active = packRows.filter((p) => p.is_active);
    const inactive = packRows.filter((p) => !p.is_active);
    return [...active, ...inactive];
  }, [packRows]);

  const activePacks = useMemo(() => packRows.filter((p) => p.is_active), [packRows]);

  // Assigned unit IDs for validation and selection
  const assignedUnitIds = useMemo(() => new Set(packRows.map((p) => p.unit_id)), [packRows]);

  // Dialog unit select options: active pack units for this base unit, not already used
  const availableUnitOptions = useMemo(() => {
    const hasPackUnitsForBase = units.some((u) => u.base_unit_id === baseUnit.id);
    return units.filter(
      (u) =>
        u.is_active &&
        u.id !== baseUnit.id &&
        (hasPackUnitsForBase ? u.base_unit_id === baseUnit.id : true) &&
        (!assignedUnitIds.has(u.id) || (editingPack != null && editingPack.unit_id === u.id))
    );
  }, [units, baseUnit.id, assignedUnitIds, editingPack]);

  const selectedDialogUnit = useMemo(
    () => units.find((u) => u.id === dialogUnitId) ?? null,
    [units, dialogUnitId]
  );

  // Rate preview calculation inside dialog
  const dialogRateInfo = useMemo(() => {
    const normF = normalizeDecimalInput(dialogFactor);
    const normP = normalizeDecimalInput(dialogPrice);
    if (!normF || !normP) return null;
    const intPart = BigInt(normF.split('.')[0] || '0');
    if (intPart === 0n && normF.replace(/0+$/, '').split('.')[1]?.length === 0) return null;
    try {
      const rate = packRate(normP, normF, 0);
      const isHigher = compareDecimal(rate, pieceSalePrice) > 0;
      return { rate, isHigher };
    } catch {
      return null;
    }
  }, [dialogFactor, dialogPrice, pieceSalePrice]);

  function openAddDialog() {
    setEditingPack(null);
    const defaultUnit = availableUnitOptions[0] ?? null;
    setDialogUnitId(defaultUnit?.id ?? null);
    setDialogFactor(defaultUnit?.conversion_factor ? formatExactDecimal(defaultUnit.conversion_factor) : '');
    setDialogPrice('');
    setDialogBarcode('');
    setDialogIsPrimary(activePacks.length === 0);
    setDialogErrors({});
    setDialogSaveError(null);
    setDialogOpen(true);
  }

  function openEditDialog(pack: VariantPack) {
    setEditingPack(pack);
    setDialogUnitId(pack.unit_id);
    setDialogFactor(formatExactDecimal(pack.conversion_factor));
    setDialogPrice(pack.sale_price ?? '');
    setDialogBarcode('');
    setDialogIsPrimary(pack.is_primary);
    setDialogErrors({});
    setDialogSaveError(null);
    setDialogOpen(true);
  }

  async function handleSetPrimary(variantUnitId: number) {
    setBusy(true);
    setError(null);
    try {
      await ipc.setPackPrimary(sessionToken, variantUnitId);
      await loadPacks();
      await onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(pack: VariantPack) {
    setBusy(true);
    setError(null);
    try {
      await ipc.setPackActive(sessionToken, pack.variant_unit_id, !pack.is_active);
      await loadPacks();
      await onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePack() {
    if (!confirmDeletePack) return;
    setDeletingPack(true);
    try {
      await ipc.removePack(sessionToken, confirmDeletePack.variant_unit_id);
      setConfirmDeletePack(null);
      await loadPacks();
      await onChanged?.();
      setFeedback({ tone: 'success', message: t('pack.saved') });
    } catch (err) {
      setError(errorText(err));
      setConfirmDeletePack(null);
    } finally {
      setDeletingPack(false);
    }
  }

  async function handleRemoveBarcode() {
    if (!confirmRemoveBarcode) return;
    setRemovingBarcode(true);
    try {
      await ipc.removeVariantBarcode(sessionToken, confirmRemoveBarcode.barcodeId);
      setConfirmRemoveBarcode(null);
      await loadPacks();
      await onChanged?.();
    } catch (err) {
      setError(errorText(err));
      setConfirmRemoveBarcode(null);
    } finally {
      setRemovingBarcode(false);
    }
  }

  async function handleRemoveSmallerUnit() {
    if (!confirmRemoveSmallerUnit) return;
    setRemovingSmallerUnit(true);
    try {
      await ipc.removeVariantAltUnit(sessionToken, confirmRemoveSmallerUnit.variant_unit_id);
      setConfirmRemoveSmallerUnit(null);
      await loadPacks();
      await onChanged?.();
    } catch (err) {
      setError(errorText(err));
      setConfirmRemoveSmallerUnit(null);
    } finally {
      setRemovingSmallerUnit(false);
    }
  }

  async function handleAddInlineBarcode(packId: number) {
    const bc = inlineBarcodeText.trim();
    if (!bc) return;
    setInlineBarcodeSaving(true);
    setInlineBarcodeError(null);
    try {
      await ipc.addPackBarcode(sessionToken, packId, bc);
      setAddingBarcodeForPackId(null);
      setInlineBarcodeText('');
      await loadPacks();
      await onChanged?.();
    } catch (err) {
      setInlineBarcodeError(errorText(err));
    } finally {
      setInlineBarcodeSaving(false);
    }
  }

  async function handleSaveDialog(e: FormEvent) {
    e.preventDefault();
    setDialogSaveError(null);

    const usedUnitIds = packRows
      .filter((p) => editingPack == null || p.variant_unit_id !== editingPack.variant_unit_id)
      .map((p) => p.unit_id);

    const validationErrors = validatePackForm(
      {
        unitId: dialogUnitId,
        factorText: dialogFactor,
        priceText: dialogPrice,
        barcodeText: editingPack ? '' : dialogBarcode,
      },
      {
        baseUnitId: baseUnit.id,
        baseIsWhole: baseUnit.isWhole,
        usedUnitIds,
        factorLocked: editingPack?.is_used ?? false,
      }
    );

    if (Object.keys(validationErrors).length > 0) {
      setDialogErrors(validationErrors);
      return;
    }

    const trimmedBarcode = dialogBarcode.trim();
    if (!editingPack && trimmedBarcode) {
      try {
        const resolved = await ipc.resolveBarcode(sessionToken, trimmedBarcode);
        if (resolved) {
          setDialogErrors({
            barcodeText: t('pack.error.barcodeUsed', { product: resolved.product_name }),
          });
          return;
        }
      } catch {
        // Backend lookup error or barcode not found - proceed
      }
    }

    setDialogSaving(true);
    try {
      if (!editingPack) {
        // Create pack
        const normFactor = normalizeDecimalInput(dialogFactor)!;
        const normPrice = dialogPrice.trim() ? normalizeDecimalInput(dialogPrice) : null;
        const newPackId = await ipc.createPack(
          sessionToken,
          variantId,
          dialogUnitId!,
          normFactor,
          normPrice,
          dialogIsPrimary
        );

        let barcodeSaved = true;
        if (trimmedBarcode) {
          try {
            await ipc.addPackBarcode(sessionToken, newPackId, trimmedBarcode);
          } catch {
            barcodeSaved = false;
          }
        }

        setDialogOpen(false);
        await loadPacks();
        await onChanged?.();

        if (!barcodeSaved) {
          setFeedback({ tone: 'warning', message: t('pack.savedBarcodeFailed') });
        } else {
          setFeedback({ tone: 'success', message: t('pack.saved') });
        }
      } else {
        // Update pack
        const factor = editingPack.is_used
          ? editingPack.conversion_factor
          : normalizeDecimalInput(dialogFactor)!;
        const price = dialogPrice.trim() ? normalizeDecimalInput(dialogPrice) : null;

        await ipc.updatePack(sessionToken, editingPack.variant_unit_id, factor, price);

        setDialogOpen(false);
        await loadPacks();
        await onChanged?.();
        setFeedback({ tone: 'success', message: t('pack.saved') });
      }
    } catch (err) {
      setDialogSaveError(errorText(err));
    } finally {
      setDialogSaving(false);
    }
  }

  const dialogId = useId();

  return (
    <div className="sk-pack-manager" data-testid="pack-manager">
      <div className="sk-catalog2__section-head">
        <div>
          <h3>{t('pack.title')}</h3>
          <p className="sk-catalog2__note">{t('pack.help', { base: baseUnit.name })}</p>
        </div>
        {!loading && packRows.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={openAddDialog}
            data-testid="pack-add-btn"
          >
            {t('pack.add')}
          </Button>
        ) : null}
      </div>

      {feedback ? (
        <Banner tone={feedback.tone} testId="pack-feedback-banner">
          {feedback.message}
        </Banner>
      ) : null}

      {error ? (
        <div className="sk-pack-error-row">
          <Banner tone="error" testId="pack-error-banner">
            {error}
          </Banner>
          <Button type="button" variant="secondary" onClick={() => void loadPacks()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="sk-pack-skeletons" data-testid="pack-manager-skeleton">
          <div className="sk-pack-skeleton-row" style={{ height: 44, opacity: 0.5, margin: '8px 0', background: 'var(--sk-surface-sunken)' }} />
          <div className="sk-pack-skeleton-row" style={{ height: 44, opacity: 0.3, margin: '8px 0', background: 'var(--sk-surface-sunken)' }} />
        </div>
      ) : packRows.length === 0 ? (
        <div className="sk-pack-empty-state" data-testid="pack-empty-state">
          <p className="sk-catalog2__note" data-testid="pack-empty-text">
            {t('pack.empty', { base: baseUnit.name })}
          </p>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={openAddDialog}
            data-testid="pack-add-empty-btn"
          >
            {t('pack.add')}
          </Button>
        </div>
      ) : (
        <div className="sk-catalog2__table-wrap" style={{ margin: '12px 0' }}>
          <table className="sk-catalog2__table" data-testid="pack-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>{t('pack.main')}</th>
                <th>{t('pack.unit')}</th>
                <th>{t('pack.holds')}</th>
                <th>{t('pack.salePrice')}</th>
                <th>{t('pack.perBase', { base: baseUnit.name })}</th>
                <th>{t('pack.barcodes')}</th>
                <th>{t('pack.status')}</th>
                <th style={{ textAlign: 'end' }}>{t('pack.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedPackRows.map((pack) => {
                const holdsStr = `${formatExactDecimal(pack.conversion_factor)} ${baseUnit.name}`;
                const priceStr =
                  pack.sale_price != null ? formatDisplayAmount(pack.sale_price) : t('pack.notSold');
                const perBaseStr =
                  pack.sale_price != null
                    ? formatDisplayAmount(packRate(pack.sale_price, pack.conversion_factor, 0))
                    : '—';

                const isAddingBarcode = addingBarcodeForPackId === pack.variant_unit_id;

                return (
                  <tr
                    key={pack.variant_unit_id}
                    className={`sk-pack-row${!pack.is_active ? ' sk-pack-row--inactive' : ''}`}
                    style={!pack.is_active ? { opacity: 0.6, background: 'var(--sk-surface-soft)' } : undefined}
                    data-testid={`pack-row-${pack.variant_unit_id}`}
                  >
                    <td>
                      <input
                        type="radio"
                        name={`pack-main-${variantId}`}
                        checked={pack.is_primary}
                        disabled={!pack.is_active || busy}
                        onChange={() => void handleSetPrimary(pack.variant_unit_id)}
                        aria-label={`${t('pack.main')} ${pack.unit_name}`}
                        data-testid={`pack-primary-${pack.variant_unit_id}`}
                      />
                    </td>
                    <td>
                      <strong>{pack.unit_name}</strong>
                    </td>
                    <td>{holdsStr}</td>
                    <td>{priceStr}</td>
                    <td>{perBaseStr}</td>
                    <td>
                      <div className="sk-pack-barcodes" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                        {pack.barcodes.map((bc, idx) => {
                          const bcId = pack.barcode_ids[idx];
                          return (
                            <span
                              key={bcId ?? bc}
                              className="sk-catalog2__pill sk-catalog2__mono"
                              data-testid={`pack-barcode-${bcId}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                            >
                              <span>{bc}</span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmRemoveBarcode({ barcodeId: bcId, barcode: bc })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                                aria-label={`${t('barcodes.remove')} ${bc}`}
                                data-testid={`pack-remove-barcode-${bcId}`}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}

                        {isAddingBarcode ? (
                          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input
                              className="sk-catalog2__input"
                              style={{ minHeight: 30, padding: '2px 6px', fontSize: 13, width: 140 }}
                              value={inlineBarcodeText}
                              onChange={(e) => setInlineBarcodeText(e.target.value)}
                              placeholder={t('barcodes.barcode')}
                              data-testid={`pack-add-barcode-input-${pack.variant_unit_id}`}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              loading={inlineBarcodeSaving}
                              disabled={!inlineBarcodeText.trim() || busy}
                              onClick={() => void handleAddInlineBarcode(pack.variant_unit_id)}
                              style={{ minHeight: 30, padding: '2px 8px', fontSize: 13 }}
                              data-testid={`pack-add-barcode-submit-${pack.variant_unit_id}`}
                            >
                              {t('common.save')}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={inlineBarcodeSaving}
                              onClick={() => {
                                setAddingBarcodeForPackId(null);
                                setInlineBarcodeText('');
                                setInlineBarcodeError(null);
                              }}
                              style={{ minHeight: 30, padding: '2px 6px', fontSize: 13 }}
                            >
                              {t('common.cancel')}
                            </Button>
                            {inlineBarcodeError ? (
                              <span style={{ color: 'var(--sk-danger)', fontSize: 12 }}>
                                {inlineBarcodeError}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="sk-link-btn"
                            disabled={busy}
                            onClick={() => {
                              setAddingBarcodeForPackId(pack.variant_unit_id);
                              setInlineBarcodeText('');
                              setInlineBarcodeError(null);
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--sk-primary)', cursor: 'pointer', fontSize: 13 }}
                            data-testid={`pack-add-barcode-trigger-${pack.variant_unit_id}`}
                          >
                            {t('pack.addBarcode')}
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`sk-catalog2__pill ${pack.is_active ? 'sk-catalog2__pill--accent' : 'sk-catalog2__pill--neutral'}`}>
                        {pack.is_active ? t('pack.active') : t('pack.inactive')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => openEditDialog(pack)}
                          data-testid={`pack-edit-btn-${pack.variant_unit_id}`}
                        >
                          {t('catalog2.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void handleToggleActive(pack)}
                          data-testid={`pack-toggle-active-${pack.variant_unit_id}`}
                        >
                          {pack.is_active ? t('pack.deactivate') : t('pack.activate')}
                        </Button>
                        {!pack.is_used ? (
                          <Button
                            type="button"
                            variant="danger"
                            disabled={busy}
                            onClick={() => setConfirmDeletePack(pack)}
                            data-testid={`pack-delete-btn-${pack.variant_unit_id}`}
                          >
                            {t('pack.delete')}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Smaller Units (is_pack = false) */}
      {smallerRows.length > 0 ? (
        <div className="sk-pack-smaller-units" style={{ marginTop: 16 }} data-testid="pack-smaller-units">
          <h4>{t('pack.smallerUnits')}</h4>
          <ul className="sk-catalog2__barcode-list">
            {smallerRows.map((sr) => (
              <li key={sr.variant_unit_id} className="sk-catalog2__barcode-row">
                <span>
                  {sr.unit_name} (×{formatExactDecimal(sr.conversion_factor)})
                </span>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() => setConfirmRemoveSmallerUnit(sr)}
                  data-testid={`pack-remove-smaller-unit-${sr.variant_unit_id}`}
                >
                  {t('barcodes.remove')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Add / Edit Pack Dialog */}
      {dialogOpen ? (
        <div className="sk-modal__backdrop" role="presentation" data-testid="pack-dialog-backdrop">
          <div className="sk-modal" role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} data-testid="pack-dialog">
            <h2 className="sk-modal__title" id={`${dialogId}-title`}>
              {editingPack ? t('pack.edit') : t('pack.add')}
            </h2>

            <form onSubmit={(e) => void handleSaveDialog(e)} className="sk-modal__body">
              {dialogSaveError ? (
                <Banner tone="error" testId="pack-dialog-error">
                  {dialogSaveError}
                </Banner>
              ) : null}

              {availableUnitOptions.length === 0 && !editingPack ? (
                <div style={{ marginBottom: 12 }}>
                  <Banner tone="info" testId="pack-no-units-banner">
                    {t('pack.noPackUnitsConfigured' as MessageKey, { base: baseUnit.name }) ||
                      `No pack units configured for ${baseUnit.name}. Go to Catalogue Setup → Units to define pack units.`}
                  </Banner>
                </div>
              ) : null}

              {/* Unit select */}
              <div className="sk-catalog2__field">
                <label className="sk-catalog2__label" htmlFor={`${dialogId}-unit`}>
                  {t('pack.unit')}
                </label>
                <select
                  id={`${dialogId}-unit`}
                  className="sk-catalog2__select"
                  value={dialogUnitId ?? ''}
                  onChange={(e) => {
                    const val = e.target.value ? Number(e.target.value) : null;
                    setDialogUnitId(val);
                    const matched = units.find((u) => u.id === val);
                    if (matched?.conversion_factor) {
                      setDialogFactor(formatExactDecimal(matched.conversion_factor));
                    }
                  }}
                  disabled={editingPack != null || dialogSaving}
                  data-testid="pack-dialog-unit-select"
                >
                  <option value="">{t('common.none')}</option>
                  {availableUnitOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code})
                    </option>
                  ))}
                </select>
                {dialogErrors.unitId ? (
                  <p className="sk-catalog2__status sk-catalog2__status--error" role="alert">
                    {t(dialogErrors.unitId as MessageKey)}
                  </p>
                ) : null}
              </div>

              {/* Holds input */}
              <div className="sk-catalog2__field">
                <label className="sk-catalog2__label" htmlFor={`${dialogId}-holds`}>
                  {t('pack.holdsLabel', { base: baseUnit.name })}
                </label>
                <input
                  id={`${dialogId}-holds`}
                  className="sk-catalog2__input"
                  inputMode="decimal"
                  value={dialogFactor}
                  onChange={(e) => setDialogFactor(e.target.value)}
                  disabled={Boolean(selectedDialogUnit?.conversion_factor) || editingPack?.is_used || dialogSaving}
                  readOnly={Boolean(selectedDialogUnit?.conversion_factor)}
                  placeholder="12"
                  data-testid="pack-dialog-holds-input"
                />
                {selectedDialogUnit && dialogFactor ? (
                  <p className="sk-muted" style={{ margin: '4px 0 0', fontWeight: 600, color: '#1e40af' }} data-testid="pack-dialog-sentence-preview">
                    👉 1 {selectedDialogUnit.name} = {dialogFactor} {baseUnit.name}
                  </p>
                ) : null}
                {editingPack?.is_used ? (
                  <p className="sk-catalog2__note">{t('pack.inUse')}</p>
                ) : null}
                {dialogErrors.factor ? (
                  <p className="sk-catalog2__status sk-catalog2__status--error" role="alert">
                    {t(dialogErrors.factor as MessageKey)}
                  </p>
                ) : null}
              </div>

              {/* Sale price input */}
              <div className="sk-catalog2__field">
                <label className="sk-catalog2__label" htmlFor={`${dialogId}-price`}>
                  {t('pack.priceLabel')}
                </label>
                <input
                  id={`${dialogId}-price`}
                  className="sk-catalog2__input"
                  inputMode="decimal"
                  value={dialogPrice}
                  onChange={(e) => setDialogPrice(e.target.value)}
                  disabled={dialogSaving}
                  placeholder="15000"
                  data-testid="pack-dialog-price-input"
                />
                {dialogRateInfo ? (
                  <div style={{ marginTop: 4 }}>
                    <p className="sk-catalog2__note" data-testid="pack-dialog-rate-helper">
                      {t('pack.perPiece', {
                        rate: formatDisplayAmount(dialogRateInfo.rate),
                        base: baseUnit.name,
                        piecePrice: formatDisplayAmount(pieceSalePrice),
                      })}
                    </p>
                    {dialogRateInfo.isHigher ? (
                      <p
                        className="sk-catalog2__status sk-catalog2__status--warning"
                        role="alert"
                        data-testid="pack-dialog-rate-warning"
                        style={{ color: 'var(--sk-warn, #b45309)' }}
                      >
                        {t('pack.warn.ratehigher')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {dialogErrors.price ? (
                  <p className="sk-catalog2__status sk-catalog2__status--error" role="alert">
                    {t(dialogErrors.price as MessageKey)}
                  </p>
                ) : null}
              </div>

              {/* Barcode input (only in Add mode) */}
              {!editingPack ? (
                <div className="sk-catalog2__field">
                  <label className="sk-catalog2__label" htmlFor={`${dialogId}-barcode`}>
                    {t('pack.barcodeLabel')}
                  </label>
                  <input
                    id={`${dialogId}-barcode`}
                    className="sk-catalog2__input"
                    value={dialogBarcode}
                    onChange={(e) => setDialogBarcode(e.target.value)}
                    disabled={dialogSaving}
                    placeholder="6131000000021"
                    data-testid="pack-dialog-barcode-input"
                  />
                  {dialogErrors.barcode ? (
                    <p className="sk-catalog2__status sk-catalog2__status--error" role="alert">
                      {t(dialogErrors.barcode as MessageKey)}
                    </p>
                  ) : null}
                  {dialogErrors.barcodeText ? (
                    <p className="sk-catalog2__status sk-catalog2__status--error" role="alert">
                      {dialogErrors.barcodeText}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Main pack checkbox (only in Add mode) */}
              {!editingPack ? (
                <div className="sk-catalog2__field">
                  <label className="sk-catalog2__checkbox" htmlFor={`${dialogId}-main`}>
                    <input
                      type="checkbox"
                      id={`${dialogId}-main`}
                      checked={dialogIsPrimary}
                      disabled={activePacks.length === 0 || dialogSaving}
                      onChange={(e) => setDialogIsPrimary(e.target.checked)}
                      data-testid="pack-dialog-main-checkbox"
                    />
                    <span>{t('pack.mainCheckbox')}</span>
                  </label>
                </div>
              ) : null}

              <div className="sk-modal__actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={dialogSaving}
                  onClick={() => setDialogOpen(false)}
                  data-testid="pack-dialog-cancel-btn"
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={dialogSaving}
                  disabled={dialogSaving}
                  data-testid="pack-dialog-save-btn"
                >
                  {t('common.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Confirm Delete Pack Dialog */}
      {confirmDeletePack ? (
        <ConfirmDialog
          title={t('pack.delete')}
          body={t('pack.confirmDelete')}
          confirmLabel={t('pack.delete')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={deletingPack}
          onConfirm={() => void handleDeletePack()}
          onCancel={() => setConfirmDeletePack(null)}
        />
      ) : null}

      {/* Confirm Remove Barcode Dialog */}
      {confirmRemoveBarcode ? (
        <ConfirmDialog
          title={t('barcodes.remove')}
          body={t('pack.confirmRemoveBarcode')}
          confirmLabel={t('barcodes.remove')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={removingBarcode}
          onConfirm={() => void handleRemoveBarcode()}
          onCancel={() => setConfirmRemoveBarcode(null)}
        />
      ) : null}

      {/* Confirm Remove Smaller Unit Dialog */}
      {confirmRemoveSmallerUnit ? (
        <ConfirmDialog
          title={t('barcodes.remove')}
          body={t('pack.confirmDelete')}
          confirmLabel={t('barcodes.remove')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={removingSmallerUnit}
          onConfirm={() => void handleRemoveSmallerUnit()}
          onCancel={() => setConfirmRemoveSmallerUnit(null)}
        />
      ) : null}
    </div>
  );
}
