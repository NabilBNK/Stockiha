import { useCallback, useEffect, useMemo, useState } from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import * as ipc from '../../shared/ipc/gateway';
import { confirmDirectPurchase } from '../../shared/ipc/directPurchaseGateway';
import type { ConfirmDirectPurchaseResult } from '../../shared/ipc/directPurchaseDto';
import type { OpenFiscalPeriod, PurchaseProductOption, Supplier, Warehouse } from '../../shared/ipc/dto';

interface Props {
  sessionToken: string;
  onPosted?: (result: ConfirmDirectPurchaseResult) => void;
}

interface DraftLine {
  id: string;
  variantId: number;
  unitId: number;
  quantity: string;
  unitCost: string;
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'New Purchase',
    subtitle: 'Record goods that have physically arrived from a supplier. Stock and accounting are posted when you confirm.',
    supplier: 'Supplier',
    supplierPlaceholder: 'Select supplier…',
    warehouse: 'Warehouse',
    warehousePlaceholder: 'Select warehouse…',
    date: 'Purchase date',
    note: 'Note',
    notePlaceholder: 'Optional internal note',
    products: 'Received products',
    addLine: 'Add product',
    product: 'Product / variant',
    productPlaceholder: 'Select product…',
    unit: 'Unit',
    quantity: 'Quantity received',
    unitCost: 'Unit purchase cost',
    lineTotal: 'Line total',
    remove: 'Remove',
    total: 'Purchase total',
    confirm: 'Confirm Purchase',
    confirmTitle: 'Confirm Direct Purchase',
    confirmMessage: 'This will post the Purchase Receipt, increase inventory, recalculate WAC, and create the Inventory / GRNI journal. Continue?',
    cancel: 'Cancel',
    loading: 'Loading purchase data…',
    noProducts: 'No active products are available.',
    invalid: 'Complete supplier, warehouse, date and every purchase line before confirming.',
    closedPeriod: 'No open fiscal period is available for this purchase.',
    dateOutsidePeriod: 'Purchase date must be inside the open fiscal period.',
    success: 'Purchase posted successfully',
    receipt: 'Purchase Receipt',
    journal: 'Journal',
    retryHint: 'The previous confirmation may have reached the database. Retry the same unchanged purchase to use the same idempotency request.',
  },
  fr: {
    title: 'Nouvel achat',
    subtitle: 'Enregistrez les marchandises physiquement reçues du fournisseur. Le stock et la comptabilité sont validés à la confirmation.',
    supplier: 'Fournisseur',
    supplierPlaceholder: 'Sélectionner un fournisseur…',
    warehouse: 'Dépôt',
    warehousePlaceholder: 'Sélectionner un dépôt…',
    date: 'Date d’achat',
    note: 'Note',
    notePlaceholder: 'Note interne facultative',
    products: 'Produits reçus',
    addLine: 'Ajouter un produit',
    product: 'Produit / variante',
    productPlaceholder: 'Sélectionner un produit…',
    unit: 'Unité',
    quantity: 'Quantité reçue',
    unitCost: 'Coût d’achat unitaire',
    lineTotal: 'Total ligne',
    remove: 'Supprimer',
    total: 'Total achat',
    confirm: 'Confirmer l’achat',
    confirmTitle: 'Confirmer l’achat direct',
    confirmMessage: 'Cette action comptabilise le reçu d’achat, augmente le stock, recalcule le CUMP et crée le journal Stock / GRNI. Continuer ?',
    cancel: 'Annuler',
    loading: 'Chargement des données d’achat…',
    noProducts: 'Aucun produit actif disponible.',
    invalid: 'Complétez le fournisseur, le dépôt, la date et chaque ligne avant de confirmer.',
    closedPeriod: 'Aucune période comptable ouverte n’est disponible.',
    dateOutsidePeriod: 'La date d’achat doit appartenir à la période comptable ouverte.',
    success: 'Achat comptabilisé avec succès',
    receipt: 'Reçu d’achat',
    journal: 'Journal',
    retryHint: 'La confirmation précédente a peut-être atteint la base. Réessayez le même achat sans le modifier afin de réutiliser la même demande idempotente.',
  },
  ar: {
    title: 'شراء جديد',
    subtitle: 'سجّل البضاعة التي وصلت فعلياً من المورد. يتم تحديث المخزون والمحاسبة عند التأكيد.',
    supplier: 'المورد',
    supplierPlaceholder: 'اختر المورد…',
    warehouse: 'المخزن',
    warehousePlaceholder: 'اختر المخزن…',
    date: 'تاريخ الشراء',
    note: 'ملاحظة',
    notePlaceholder: 'ملاحظة داخلية اختيارية',
    products: 'المنتجات المستلمة',
    addLine: 'إضافة منتج',
    product: 'المنتج / المتغير',
    productPlaceholder: 'اختر المنتج…',
    unit: 'الوحدة',
    quantity: 'الكمية المستلمة',
    unitCost: 'سعر الشراء للوحدة',
    lineTotal: 'مجموع السطر',
    remove: 'حذف',
    total: 'إجمالي الشراء',
    confirm: 'تأكيد الشراء',
    confirmTitle: 'تأكيد الشراء المباشر',
    confirmMessage: 'سيتم ترحيل وصل الشراء وزيادة المخزون وإعادة حساب متوسط التكلفة وإنشاء قيد المخزون / GRNI. هل تريد المتابعة؟',
    cancel: 'إلغاء',
    loading: 'جاري تحميل بيانات الشراء…',
    noProducts: 'لا توجد منتجات نشطة متاحة.',
    invalid: 'أكمل المورد والمخزن والتاريخ وكل سطر شراء قبل التأكيد.',
    closedPeriod: 'لا توجد فترة محاسبية مفتوحة لهذا الشراء.',
    dateOutsidePeriod: 'يجب أن يكون تاريخ الشراء داخل الفترة المحاسبية المفتوحة.',
    success: 'تم ترحيل الشراء بنجاح',
    receipt: 'وصل الشراء',
    journal: 'القيد',
    retryHint: 'قد يكون التأكيد السابق وصل إلى قاعدة البيانات. أعد محاولة نفس الشراء دون تغييره حتى يتم استخدام نفس طلب منع التكرار.',
  },
};

function newLine(): DraftLine {
  return {
    id: crypto.randomUUID(),
    variantId: 0,
    unitId: 0,
    quantity: '1',
    unitCost: '',
  };
}

function productLabel(option: PurchaseProductOption): string {
  const variant = option.variant_name?.trim();
  return `${option.product_name}${variant ? ` — ${variant}` : ''} (${option.sku})`;
}

function previewAmount(quantity: string, cost: string): string {
  const qty = Number(quantity);
  const unitCost = Number(cost);
  if (!Number.isFinite(qty) || !Number.isFinite(unitCost) || qty < 0 || unitCost < 0) return '—';
  return (qty * unitCost).toFixed(2);
}

export function DirectPurchaseScreen({ sessionToken, onPosted }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<PurchaseProductOption[]>([]);
  const [period, setPeriod] = useState<OpenFiscalPeriod | null>(null);
  const [supplierId, setSupplierId] = useState(0);
  const [warehouseId, setWarehouseId] = useState(0);
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<ConfirmDirectPurchaseResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [supplierRows, warehouseRows, productRows, openPeriod] = await Promise.all([
        ipc.listSuppliers(sessionToken, false),
        ipc.listWarehouses(sessionToken),
        ipc.listPurchaseProductOptions(sessionToken),
        ipc.getOpenFiscalPeriod(sessionToken),
      ]);
      const activeWarehouses = warehouseRows.filter((warehouse) => warehouse.is_active);
      const activeProducts = productRows.filter((product) => product.is_active);
      setSuppliers(supplierRows.filter((supplier) => supplier.is_active));
      setWarehouses(activeWarehouses);
      setProducts(activeProducts);
      setPeriod(openPeriod);
      if (activeWarehouses.length === 1) setWarehouseId(activeWarehouses[0].id);
    } catch (error: unknown) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPreview = useMemo(() => {
    const total = lines.reduce((sum, line) => {
      const qty = Number(line.quantity);
      const cost = Number(line.unitCost);
      if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0 || cost < 0) return sum;
      return sum + qty * cost;
    }, 0);
    return total.toFixed(2);
  }, [lines]);

  const dateInsidePeriod = period !== null
    && documentDate >= period.starts_on
    && documentDate <= period.ends_on;

  const validLines = lines.length > 0 && lines.every((line) => {
    const qty = Number(line.quantity);
    const cost = Number(line.unitCost);
    return line.variantId > 0
      && line.unitId > 0
      && Number.isFinite(qty)
      && qty > 0
      && Number.isFinite(cost)
      && cost >= 0;
  });

  const canSubmit = !submitting
    && supplierId > 0
    && warehouseId > 0
    && dateInsidePeriod
    && validLines;

  function selectProduct(lineId: string, variantId: number) {
    const option = products.find((product) => product.variant_id === variantId);
    setLines((current) => current.map((line) => line.id === lineId
      ? {
          ...line,
          variantId,
          unitId: option?.default_unit_id ?? 0,
          unitCost: option?.last_purchase_cost ?? option?.default_unit_cost ?? '',
        }
      : line));
  }

  function updateLine(lineId: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  }

  async function postPurchase() {
    if (!period || !canSubmit) return;
    setConfirmOpen(false);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const posted = await confirmDirectPurchase(sessionToken, {
        request_id: crypto.randomUUID(),
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        fiscal_period_id: period.id,
        document_date: documentDate,
        note: note.trim() || null,
        lines: lines.map((line) => ({
          variant_id: line.variantId,
          unit_id: line.unitId,
          quantity_received: line.quantity,
          unit_cost: line.unitCost,
        })),
      });
      setResult(posted);
      onPosted?.(posted);
      setLines([newLine()]);
      setNote('');
    } catch (error: unknown) {
      setSubmitError(errorText(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <section className="sk-screen"><Spinner label={text.loading} /></section>;
  }

  return (
    <section className="sk-screen" aria-labelledby="direct-purchase-title">
      <header className="sk-screen__header">
        <div>
          <h1 id="direct-purchase-title">{text.title}</h1>
          <p className="sk-muted">{text.subtitle}</p>
        </div>
      </header>

      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {!period ? <Banner tone="warning">{text.closedPeriod}</Banner> : null}
      {submitError ? (
        <Banner tone="error">
          {submitError} <span className="sk-muted">{text.retryHint}</span>
        </Banner>
      ) : null}
      {result ? (
        <Banner tone="success">
          <strong>{text.success}.</strong>{' '}
          {text.receipt}: {result.document_number} · {text.total}: {result.total_amount} DZD ·{' '}
          {text.journal}: {result.journal_document_number ?? result.journal_document_id}
        </Banner>
      ) : null}

      <div className="sk-card sk-form-grid">
        <label className="sk-field">
          <span>{text.supplier}</span>
          <select value={supplierId} onChange={(event) => setSupplierId(Number(event.target.value))}>
            <option value={0}>{text.supplierPlaceholder}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>
            ))}
          </select>
        </label>

        <label className="sk-field">
          <span>{text.warehouse}</span>
          <select value={warehouseId} onChange={(event) => setWarehouseId(Number(event.target.value))}>
            <option value={0}>{text.warehousePlaceholder}</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>
            ))}
          </select>
        </label>

        <label className="sk-field">
          <span>{text.date}</span>
          <input
            type="date"
            value={documentDate}
            min={period?.starts_on}
            max={period?.ends_on}
            onChange={(event) => setDocumentDate(event.target.value)}
          />
          {period && !dateInsidePeriod ? <small className="sk-error-text">{text.dateOutsidePeriod}</small> : null}
        </label>

        <label className="sk-field">
          <span>{text.note}</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={text.notePlaceholder} />
        </label>
      </div>

      <div className="sk-card">
        <div className="sk-screen__header">
          <h2>{text.products}</h2>
          <Button type="button" variant="secondary" onClick={() => setLines((current) => [...current, newLine()])}>
            {text.addLine}
          </Button>
        </div>

        {products.length === 0 ? <p className="sk-muted">{text.noProducts}</p> : null}

        <div className="sk-table-wrap">
          <table className="sk-table" data-testid="direct-purchase-lines">
            <thead>
              <tr>
                <th>{text.product}</th>
                <th>{text.unit}</th>
                <th>{text.quantity}</th>
                <th>{text.unitCost}</th>
                <th>{text.lineTotal}</th>
                <th aria-label={text.remove} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const option = products.find((product) => product.variant_id === line.variantId);
                return (
                  <tr key={line.id}>
                    <td>
                      <select value={line.variantId} onChange={(event) => selectProduct(line.id, Number(event.target.value))}>
                        <option value={0}>{text.productPlaceholder}</option>
                        {products.map((product) => (
                          <option key={product.variant_id} value={product.variant_id}>{productLabel(product)}</option>
                        ))}
                      </select>
                    </td>
                    <td>{option?.default_unit_code ?? '—'}</td>
                    <td>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={line.quantity}
                        onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitCost}
                        onChange={(event) => updateLine(line.id, { unitCost: event.target.value })}
                      />
                    </td>
                    <td className="sk-num">{previewAmount(line.quantity, line.unitCost)} DZD</td>
                    <td>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={lines.length === 1}
                        onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}
                      >
                        {text.remove}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="sk-screen__header">
          <strong>{text.total}: {totalPreview} DZD</strong>
          <Button type="button" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
            {submitting ? '…' : text.confirm}
          </Button>
        </div>
        {!canSubmit && !submitting ? <p className="sk-muted">{text.invalid}</p> : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={text.confirmTitle}
        message={text.confirmMessage}
        confirmLabel={text.confirm}
        cancelLabel={text.cancel}
        onConfirm={() => void postPurchase()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
