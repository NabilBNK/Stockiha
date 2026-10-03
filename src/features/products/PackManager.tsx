import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Banner, Button, ConfirmDialog } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type MessageKey } from '../../shared/i18n';
import * as ipc from '../../shared/ipc/gateway';
import type { UnitLifecycleItem, VariantDetail, VariantPack } from '../../shared/ipc/dto';
import { formatDisplayAmount } from '../../shared/utils/formatters';
import { compareDecimal, multiplyExactDecimal, packRate } from '../../shared/utils/packMath';
import { formatExactDecimal } from '../inventory/exactDecimal';
import { normalizeDecimalInput, validatePackForm, type PackFormErrors } from './packValidation';
import { invalidatePrimaryPacks } from '../../shared/hooks/usePrimaryPacks';

function variantDisplayLabel(v: VariantDetail): string {
  if (v.effective_variant_name && v.effective_variant_name !== v.sku) {
    return `${v.effective_variant_name} (${v.sku})`;
  }
  if (v.attribute_signature) {
    return `${v.attribute_signature} (${v.sku})`;
  }
  return v.name_override || v.sku || `#${v.variant_id}`;
}

function variantSearchHaystack(v: VariantDetail): string {
  const combo = v.attributes ? v.attributes.map((a) => a.value).join(' ') : '';
  const barcodes = v.barcodes ? v.barcodes.map((b) => b.barcode).join(' ') : '';
  return `${v.effective_variant_name} ${v.name_override ?? ''} ${v.sku} ${v.attribute_signature ?? ''} ${combo} ${barcodes}`.toLowerCase();
}

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
  siblingVariants?: VariantDetail[];
  sessionToken: string;
  onChanged?: () => Promise<void> | void;
  onPacksLoaded?: (packs: VariantPack[]) => void;
}

export function PackManager({
  variantId,
  baseUnit,
  pieceSalePrice,
  units,
  siblingVariants,
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

  // Apply pack to other variants dialog state
  const [applyPack, setApplyPack] = useState<VariantPack | null>(null);
  const [applySelectedVariantIds, setApplySelectedVariantIds] = useState<number[]>([]);
  const [applyFilterText, setApplyFilterText] = useState('');
  const [applySetPrimary, setApplySetPrimary] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{ current: number; total: number } | null>(null);

  // Copy packs from another variant dialog state
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySourceVariantId, setCopySourceVariantId] = useState<number | null>(null);
  const [copyFilterText, setCopyFilterText] = useState('');
  const [copySourcePacks, setCopySourcePacks] = useState<VariantPack[]>([]);
  const [copyLoadingPacks, setCopyLoadingPacks] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);

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

  // Packs (is_pack = true)
  const packRows = useMemo(() => packs.filter((p) => p.is_pack), [packs]);

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
    return units.filter(
      (u) =>
        u.is_active &&
        u.is_pack &&
        u.id !== baseUnit.id &&
        (u.base_unit_id == null || u.base_unit_id === baseUnit.id) &&
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

  // Suggested max pack price calculation: unit price * factor
  const suggestedPriceInfo = useMemo(() => {
    const normFactor = normalizeDecimalInput(dialogFactor);
    const normPrice = normalizeDecimalInput(pieceSalePrice);
    if (!normFactor || !normPrice) return null;
    const factorInt = BigInt(normFactor.split('.')[0] || '0');
    if (factorInt === 0n && normFactor.replace(/0+$/, '').split('.')[1]?.length === 0) return null;
    const priceInt = BigInt(normPrice.split('.')[0] || '0');
    if (priceInt === 0n && normPrice.replace(/0+$/, '').split('.')[1]?.length === 0) return null;
    try {
      const suggestedPrice = multiplyExactDecimal(normPrice, normFactor);
      if (!suggestedPrice || suggestedPrice === '0') return null;
      return {
        suggestedPrice,
        factor: normFactor,
        unitPrice: normPrice,
      };
    } catch {
      return null;
    }
  }, [dialogFactor, pieceSalePrice]);

  function openAddDialog() {
    setEditingPack(null);
    const defaultUnit = availableUnitOptions[0] ?? null;
    setDialogUnitId(defaultUnit?.id ?? null);
    const factorStr = defaultUnit?.conversion_factor ? formatExactDecimal(defaultUnit.conversion_factor) : '';
    setDialogFactor(factorStr);

    let defaultPrice = '';
    if (pieceSalePrice && factorStr) {
      try {
        const normP = normalizeDecimalInput(pieceSalePrice);
        const normF = normalizeDecimalInput(factorStr);
        if (normP && normF) {
          const mult = multiplyExactDecimal(normP, normF);
          if (mult && mult !== '0') {
            defaultPrice = mult;
          }
        }
      } catch {
        defaultPrice = '';
      }
    }
    setDialogPrice(defaultPrice);
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
      invalidatePrimaryPacks();
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
      invalidatePrimaryPacks();
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
      invalidatePrimaryPacks();
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
        const autoPrice = suggestedPriceInfo?.suggestedPrice ?? null;
        const normPrice = dialogPrice.trim() ? normalizeDecimalInput(dialogPrice) : autoPrice;
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
        invalidatePrimaryPacks();
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
        const autoPrice = suggestedPriceInfo?.suggestedPrice ?? null;
        const price = dialogPrice.trim() ? normalizeDecimalInput(dialogPrice) : autoPrice;

        await ipc.updatePack(sessionToken, editingPack.variant_unit_id, factor, price);

        setDialogOpen(false);
        invalidatePrimaryPacks();
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

  function openApplyDialog(pack: VariantPack) {
    setApplyPack(pack);
    setApplySelectedVariantIds(siblingVariants ? siblingVariants.map((v) => v.variant_id) : []);
    setApplyFilterText('');
    setApplySetPrimary(pack.is_primary);
    setApplyProgress(null);
  }

  async function handleApplyToVariants() {
    if (!applyPack || applySelectedVariantIds.length === 0) return;
    setApplyBusy(true);
    setApplyProgress({ current: 0, total: applySelectedVariantIds.length });
    let createdCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < applySelectedVariantIds.length; i++) {
      const targetVariantId = applySelectedVariantIds[i];
      try {
        const targetPacks = await ipc.listVariantPacks(sessionToken, targetVariantId);
        const alreadyHasUnit = targetPacks.some((p) => p.unit_id === applyPack.unit_id);
        if (alreadyHasUnit) {
          skippedCount++;
        } else {
          await ipc.createPack(
            sessionToken,
            targetVariantId,
            applyPack.unit_id,
            applyPack.conversion_factor,
            applyPack.sale_price,
            applySetPrimary
          );
          createdCount++;
        }
      } catch {
        skippedCount++;
      }
      setApplyProgress({ current: i + 1, total: applySelectedVariantIds.length });
    }

    if (createdCount > 0) {
      invalidatePrimaryPacks();
    }
    setApplyBusy(false);
    setApplyPack(null);
    setFeedback({
      tone: 'success',
      message: `${t('pack.applySuccess', { count: createdCount })}${
        skippedCount > 0 ? ' ' + t('pack.applySkipped', { count: skippedCount }) : ''
      }`,
    });
    await onChanged?.();
  }

  function openCopyDialog() {
    setCopyDialogOpen(true);
    setCopyFilterText('');
    setCopySourceVariantId(null);
    setCopySourcePacks([]);
    if (siblingVariants && siblingVariants.length > 0) {
      void handleSelectCopySource(siblingVariants[0].variant_id);
    }
  }

  async function handleSelectCopySource(sourceVariantId: number) {
    setCopySourceVariantId(sourceVariantId);
    setCopyLoadingPacks(true);
    try {
      const rows = await ipc.listVariantPacks(sessionToken, sourceVariantId);
      setCopySourcePacks(rows.filter((p) => p.is_pack && p.is_active));
    } catch {
      setCopySourcePacks([]);
    } finally {
      setCopyLoadingPacks(false);
    }
  }

  async function handleCopyPacks() {
    if (copySourcePacks.length === 0) return;
    setCopyBusy(true);
    let createdCount = 0;
    for (const pack of copySourcePacks) {
      if (!assignedUnitIds.has(pack.unit_id)) {
        try {
          await ipc.createPack(
            sessionToken,
            variantId,
            pack.unit_id,
            pack.conversion_factor,
            pack.sale_price,
            pack.is_primary
          );
          createdCount++;
        } catch {
          // ignore duplicate
        }
      }
    }
    if (createdCount > 0) {
      invalidatePrimaryPacks();
    }
    setCopyBusy(false);
    setCopyDialogOpen(false);
    setFeedback({
      tone: 'success',
      message: t('pack.copySuccess', { count: createdCount }),
    });
    await loadPacks();
    await onChanged?.();
  }

  const filteredSiblingsForApply = useMemo(() => {
    if (!siblingVariants) return [];
    const q = applyFilterText.trim().toLowerCase();
    if (!q) return siblingVariants;
    return siblingVariants.filter((v) => variantSearchHaystack(v).includes(q));
  }, [siblingVariants, applyFilterText]);

  const matchingApplyIds = useMemo(
    () => filteredSiblingsForApply.map((v) => v.variant_id),
    [filteredSiblingsForApply]
  );

  const filteredSiblingsForCopy = useMemo(() => {
    if (!siblingVariants) return [];
    const q = copyFilterText.trim().toLowerCase();
    if (!q) return siblingVariants;
    return siblingVariants.filter((v) => variantSearchHaystack(v).includes(q));
  }, [siblingVariants, copyFilterText]);

  const dialogId = useId();

  return (
    <div className="sk-pack-manager" data-testid="pack-manager">
      <div className="sk-catalog2__section-head" style={{ marginBottom: 10, alignItems: 'center' }}>
        <p className="sk-catalog2__note" style={{ margin: 0, fontSize: 13 }}>
          {t('pack.help', { base: baseUnit.name })}
        </p>
        {!loading && packRows.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {siblingVariants && siblingVariants.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={openCopyDialog}
                data-testid="pack-copy-header-btn"
                style={{ minHeight: 34, padding: '0 12px', fontSize: 13, whiteSpace: 'nowrap' }}
              >
                {t('pack.copyFromVariant')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={openAddDialog}
              data-testid="pack-add-btn"
              style={{ minHeight: 34, padding: '0 12px', fontSize: 13, whiteSpace: 'nowrap' }}
            >
              + {t('pack.add')}
            </Button>
          </div>
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
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={openAddDialog}
              data-testid="pack-add-empty-btn"
            >
              {t('pack.add')}
            </Button>
            {siblingVariants && siblingVariants.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={openCopyDialog}
                data-testid="pack-copy-empty-btn"
              >
                {t('pack.copyFromVariant')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="sk-catalog2__table-wrap" style={{ margin: '10px 0', border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-radius-sm)' }}>
          <table className="sk-pack-table" data-testid="pack-table">
            <thead>
              <tr>
                <th style={{ width: 44, textAlign: 'center' }}>{t('pack.main')}</th>
                <th>{t('pack.unit')}</th>
                <th>{t('pack.salePrice')}</th>
                <th>{t('pack.barcodes')}</th>
                <th style={{ width: 80, textAlign: 'center' }}>{t('pack.status')}</th>
                <th style={{ textAlign: 'end', minWidth: 180 }}>{t('pack.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedPackRows.map((pack) => {
                const holdsStr = `${formatExactDecimal(pack.conversion_factor)} ${baseUnit.name}`;
                const effectivePackPrice =
                  pack.sale_price ??
                  (pieceSalePrice
                    ? multiplyExactDecimal(pieceSalePrice, formatExactDecimal(pack.conversion_factor))
                    : null);
                const priceStr =
                  effectivePackPrice != null ? formatDisplayAmount(effectivePackPrice) : formatDisplayAmount('0');
                const perBaseStr =
                  effectivePackPrice != null
                    ? formatDisplayAmount(packRate(effectivePackPrice, pack.conversion_factor, 0))
                    : null;

                const isAddingBarcode = addingBarcodeForPackId === pack.variant_unit_id;

                return (
                  <tr
                    key={pack.variant_unit_id}
                    className={`sk-pack-row${!pack.is_active ? ' sk-pack-row--inactive' : ''}`}
                    style={!pack.is_active ? { opacity: 0.6, background: 'var(--sk-surface-soft)' } : undefined}
                    data-testid={`pack-row-${pack.variant_unit_id}`}
                  >
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="radio"
                        name={`pack-main-${variantId}`}
                        checked={pack.is_primary}
                        disabled={!pack.is_active || busy}
                        onChange={() => void handleSetPrimary(pack.variant_unit_id)}
                        aria-label={`${t('pack.main')} ${pack.unit_name}`}
                        data-testid={`pack-primary-${pack.variant_unit_id}`}
                        style={{ cursor: pack.is_active ? 'pointer' : 'default', width: 18, height: 18 }}
                      />
                    </td>
                    <td>
                      <strong style={{ display: 'block', fontSize: 14 }}>{pack.unit_name}</strong>
                      <span style={{ fontSize: 12, color: 'var(--sk-muted)', whiteSpace: 'nowrap' }}>
                        ({holdsStr})
                      </span>
                    </td>
                    <td>
                      <strong style={{ display: 'block', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                        {priceStr}
                      </strong>
                      {perBaseStr ? (
                        <span style={{ fontSize: 12, color: 'var(--sk-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {perBaseStr} / {baseUnit.name}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <div className="sk-pack-barcodes" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                        {pack.barcodes.map((bc, idx) => {
                          const bcId = pack.barcode_ids[idx];
                          return (
                            <span
                              key={bcId ?? bc}
                              className="sk-catalog2__pill sk-catalog2__mono"
                              data-testid={`pack-barcode-${bcId}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '1px 8px' }}
                            >
                              <span>{bc}</span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmRemoveBarcode({ barcodeId: bcId, barcode: bc })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700, fontSize: 14, lineHeight: 1 }}
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
                              style={{ minHeight: 28, padding: '2px 6px', fontSize: 12, width: 120 }}
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
                              style={{ minHeight: 28, padding: '0 8px', fontSize: 12 }}
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
                              style={{ minHeight: 28, padding: '0 6px', fontSize: 12 }}
                            >
                              {t('common.cancel')}
                            </Button>
                            {inlineBarcodeError ? (
                              <span style={{ color: 'var(--sk-danger)', fontSize: 11 }}>
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
                            style={{ background: 'none', border: 'none', color: 'var(--sk-primary)', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}
                            data-testid={`pack-add-barcode-trigger-${pack.variant_unit_id}`}
                          >
                            {t('pack.addBarcode')}
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`sk-catalog2__pill ${pack.is_active ? 'sk-catalog2__pill--accent' : 'sk-catalog2__pill--neutral'}`} style={{ fontSize: 11, padding: '1px 8px' }}>
                        {pack.is_active ? t('pack.active') : t('pack.inactive')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      <div style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {siblingVariants && siblingVariants.length > 0 ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy || !pack.is_active}
                            onClick={() => openApplyDialog(pack)}
                            data-testid={`pack-apply-btn-${pack.variant_unit_id}`}
                            style={{ minHeight: 30, padding: '0 8px', fontSize: 12 }}
                            title={t('pack.applyToOthers')}
                          >
                            {t('pack.applyToOthers')}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => openEditDialog(pack)}
                          data-testid={`pack-edit-btn-${pack.variant_unit_id}`}
                          style={{ minHeight: 30, padding: '0 8px', fontSize: 12 }}
                        >
                          {t('catalog2.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void handleToggleActive(pack)}
                          data-testid={`pack-toggle-active-${pack.variant_unit_id}`}
                          style={{ minHeight: 30, padding: '0 8px', fontSize: 12 }}
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
                            style={{ minHeight: 30, padding: '0 8px', fontSize: 12 }}
                            title={t('pack.delete')}
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
                      const fStr = formatExactDecimal(matched.conversion_factor);
                      setDialogFactor(fStr);
                      if (pieceSalePrice) {
                        try {
                          const normP = normalizeDecimalInput(pieceSalePrice);
                          const normF = normalizeDecimalInput(fStr);
                          if (normP && normF) {
                            const mult = multiplyExactDecimal(normP, normF);
                            if (mult && mult !== '0') {
                              setDialogPrice(mult);
                            }
                          }
                        } catch {
                          // ignore
                        }
                      }
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
                  placeholder={suggestedPriceInfo?.suggestedPrice || '15000'}
                  data-testid="pack-dialog-price-input"
                />
                {suggestedPriceInfo ? (
                  <div
                    style={{
                      margin: '6px 0 0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--sk-primary-subtle, #eff6ff)',
                      border: '1px solid var(--sk-primary-border, #bfdbfe)',
                      borderRadius: 'var(--sk-radius-sm, 6px)',
                      padding: '6px 10px',
                      fontSize: 12,
                    }}
                    data-testid="pack-dialog-price-suggestion-prompt"
                  >
                    <span style={{ color: '#1e40af', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span aria-hidden="true">💡</span>
                      <span>
                        <strong>{t('pack.suggestedMaxPrice')}:</strong>{' '}
                        {formatDisplayAmount(suggestedPriceInfo.suggestedPrice)}{' '}
                        <span style={{ opacity: 0.85, fontWeight: 'normal' }}>
                          ({suggestedPriceInfo.factor} {baseUnit.name} × {formatDisplayAmount(pieceSalePrice)})
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="sk-link-btn"
                      onClick={() => setDialogPrice(suggestedPriceInfo.suggestedPrice)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#1d4ed8',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: '2px 4px',
                        textDecoration: 'underline',
                        whiteSpace: 'nowrap',
                        marginInlineStart: 8,
                      }}
                      data-testid="pack-dialog-use-suggested-price"
                    >
                      {t('pack.useSuggestedPrice')}
                    </button>
                  </div>
                ) : null}
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


      {/* Apply Pack To Other Variants Dialog */}
      {applyPack ? (
        <div
          className="sk-modal-backdrop"
          role="presentation"
          onClick={() => !applyBusy && setApplyPack(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pack-apply-title"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-radius-md)', padding: 24, maxWidth: 540, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
            data-testid="pack-apply-dialog"
          >
            <h3 id="pack-apply-title" style={{ margin: '0 0 8px 0', fontSize: 16 }}>
              {t('pack.applyDialogTitle')}
            </h3>
            <p className="sk-catalog2__note" style={{ margin: '0 0 14px 0', fontSize: 13 }}>
              {t('pack.applyDialogDesc', {
                unit: applyPack.unit_name,
                factor: formatExactDecimal(applyPack.conversion_factor),
                price: (() => {
                  const effectiveApplyPrice =
                    applyPack.sale_price ??
                    (pieceSalePrice
                      ? multiplyExactDecimal(pieceSalePrice, formatExactDecimal(applyPack.conversion_factor))
                      : null);
                  return effectiveApplyPrice ? formatDisplayAmount(effectiveApplyPrice) : formatDisplayAmount('0');
                })(),
              })}
            </p>

            <div style={{ marginBottom: 10 }}>
              <input
                className="sk-catalog2__input"
                value={applyFilterText}
                disabled={applyBusy}
                onChange={(e) => setApplyFilterText(e.target.value)}
                placeholder={t('pack.searchPlaceholder')}
                data-testid="pack-apply-search-input"
                style={{ width: '100%', minHeight: 32, padding: '4px 8px', fontSize: 13 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {applySelectedVariantIds.length} / {siblingVariants?.length ?? 0}
                {applyFilterText.trim() ? ` (${filteredSiblingsForApply.length} ${t('common.none') === 'None' ? 'matching' : 'correspondants'})` : ''}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {applyFilterText.trim() ? (
                  <>
                    <button
                      type="button"
                      className="sk-link-btn"
                      disabled={applyBusy || matchingApplyIds.length === 0}
                      onClick={() => setApplySelectedVariantIds((prev) => Array.from(new Set([...prev, ...matchingApplyIds])))}
                      style={{ background: 'none', border: 'none', color: 'var(--sk-primary)', cursor: 'pointer', fontSize: 12 }}
                      data-testid="pack-apply-select-matching"
                    >
                      {t('pack.selectAllMatching', { count: matchingApplyIds.length })}
                    </button>
                    <span style={{ color: 'var(--sk-border)' }}>|</span>
                    <button
                      type="button"
                      className="sk-link-btn"
                      disabled={applyBusy || matchingApplyIds.length === 0}
                      onClick={() => setApplySelectedVariantIds((prev) => prev.filter((id) => !matchingApplyIds.includes(id)))}
                      style={{ background: 'none', border: 'none', color: 'var(--sk-primary)', cursor: 'pointer', fontSize: 12 }}
                      data-testid="pack-apply-deselect-matching"
                    >
                      {t('pack.deselectAllMatching', { count: matchingApplyIds.length })}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="sk-link-btn"
                      disabled={applyBusy}
                      onClick={() => setApplySelectedVariantIds(siblingVariants ? siblingVariants.map((v) => v.variant_id) : [])}
                      style={{ background: 'none', border: 'none', color: 'var(--sk-primary)', cursor: 'pointer', fontSize: 12 }}
                    >
                      {t('pack.applySelectAll')}
                    </button>
                    <span style={{ color: 'var(--sk-border)' }}>|</span>
                    <button
                      type="button"
                      className="sk-link-btn"
                      disabled={applyBusy}
                      onClick={() => setApplySelectedVariantIds([])}
                      style={{ background: 'none', border: 'none', color: 'var(--sk-primary)', cursor: 'pointer', fontSize: 12 }}
                    >
                      {t('pack.applyDeselectAll')}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                border: '1px solid var(--sk-border)',
                borderRadius: 'var(--sk-radius-sm)',
                maxHeight: 220,
                overflowY: 'auto',
                padding: '4px 8px',
                marginBottom: 16,
                background: 'var(--sk-surface-soft)',
              }}
              data-testid="pack-apply-variant-list"
            >
              {filteredSiblingsForApply.length === 0 ? (
                <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--sk-text-muted)', fontSize: 13 }}>
                  {t('pack.noMatchingVariants')}
                </div>
              ) : (
                filteredSiblingsForApply.map((v) => {
                  const checked = applySelectedVariantIds.includes(v.variant_id);
                  return (
                    <label
                      key={v.variant_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 4px',
                        borderBottom: '1px solid var(--sk-border-subtle)',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                      data-testid={`pack-apply-row-${v.variant_id}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={applyBusy}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setApplySelectedVariantIds((prev) => [...prev, v.variant_id]);
                          } else {
                            setApplySelectedVariantIds((prev) => prev.filter((id) => id !== v.variant_id));
                          }
                        }}
                      />
                      <span>{variantDisplayLabel(v)}</span>
                    </label>
                  );
                })
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={applySetPrimary}
                disabled={applyBusy}
                onChange={(e) => setApplySetPrimary(e.target.checked)}
                data-testid="pack-apply-primary-checkbox"
              />
              <span>{t('pack.applyPrimaryCheckbox')}</span>
            </label>

            {applyProgress ? (
              <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--sk-primary)' }}>
                {t('pack.applyingProgress', { current: applyProgress.current, total: applyProgress.total })}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button
                type="button"
                variant="secondary"
                disabled={applyBusy}
                onClick={() => setApplyPack(null)}
                data-testid="pack-apply-cancel-btn"
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={applyBusy}
                disabled={applyBusy || applySelectedVariantIds.length === 0}
                onClick={() => void handleApplyToVariants()}
                data-testid="pack-apply-submit-btn"
              >
                {t('pack.applyBtn', { count: applySelectedVariantIds.length })}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Copy Packs From Another Variant Dialog */}
      {copyDialogOpen ? (
        <div
          className="sk-modal-backdrop"
          role="presentation"
          onClick={() => !copyBusy && setCopyDialogOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pack-copy-title"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-radius-md)', padding: 24, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
            data-testid="pack-copy-dialog"
          >
            <h3 id="pack-copy-title" style={{ margin: '0 0 12px 0', fontSize: 16 }}>
              {t('pack.copyDialogTitle')}
            </h3>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--sk-text-muted)', marginBottom: 4 }}>
                {t('pack.copySelectSource')}
              </label>
              <input
                className="sk-catalog2__input"
                value={copyFilterText}
                disabled={copyBusy}
                onChange={(e) => setCopyFilterText(e.target.value)}
                placeholder={t('pack.searchPlaceholder')}
                data-testid="pack-copy-search-input"
                style={{ width: '100%', minHeight: 32, padding: '4px 8px', fontSize: 13, marginBottom: 8 }}
              />

              <div
                style={{
                  border: '1px solid var(--sk-border)',
                  borderRadius: 'var(--sk-radius-sm)',
                  maxHeight: 160,
                  overflowY: 'auto',
                  background: 'var(--sk-surface-soft)',
                }}
                data-testid="pack-copy-variant-list"
              >
                {filteredSiblingsForCopy.length === 0 ? (
                  <div style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--sk-text-muted)', fontSize: 13 }}>
                    {t('pack.noMatchingVariants')}
                  </div>
                ) : (
                  filteredSiblingsForCopy.map((v) => {
                    const isSelected = v.variant_id === copySourceVariantId;
                    return (
                      <div
                        key={v.variant_id}
                        onClick={() => !copyBusy && void handleSelectCopySource(v.variant_id)}
                        style={{
                          padding: '6px 10px',
                          fontSize: 13,
                          cursor: 'pointer',
                          background: isSelected ? 'var(--sk-primary-subtle, rgba(37,99,235,0.12))' : 'transparent',
                          borderLeft: isSelected ? '3px solid var(--sk-primary)' : '3px solid transparent',
                          borderBottom: '1px solid var(--sk-border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                        data-testid={`pack-copy-candidate-${v.variant_id}`}
                      >
                        <span style={{ fontWeight: isSelected ? 600 : 400 }}>{variantDisplayLabel(v)}</span>
                        {isSelected ? <span style={{ color: 'var(--sk-primary)', fontSize: 13, fontWeight: 700 }}>✓</span> : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {copyLoadingPacks ? (
              <p className="sk-catalog2__note">{t('common.loading')}</p>
            ) : copySourcePacks.length === 0 ? (
              <p className="sk-catalog2__note" style={{ color: 'var(--sk-text-muted)' }}>
                {t('pack.copyNoPacksOnSource')}
              </p>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  {t('pack.barcodesElsewhere')}
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                  {copySourcePacks.map((p) => (
                    <li key={p.variant_unit_id} style={{ marginBottom: 4 }}>
                      <strong>{p.unit_name}</strong> (holds {formatExactDecimal(p.conversion_factor)} {baseUnit.name})
                      {p.sale_price ? ` — ${formatDisplayAmount(p.sale_price)}` : ''}
                      {p.is_primary ? ` ★` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <Button
                type="button"
                variant="secondary"
                disabled={copyBusy}
                onClick={() => setCopyDialogOpen(false)}
                data-testid="pack-copy-cancel-btn"
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={copyBusy}
                disabled={copyBusy || copySourcePacks.length === 0}
                onClick={() => void handleCopyPacks()}
                data-testid="pack-copy-submit-btn"
              >
                {t('pack.copyCountPacks', { count: copySourcePacks.length })}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
