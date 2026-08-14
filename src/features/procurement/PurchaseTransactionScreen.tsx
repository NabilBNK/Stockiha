/**
 * Stockiha Single-Entry Purchase Workflow Screen.
 * Compact, data-dense, modern ERP purchase receiving workstation following Stockiha DESIGN.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useI18n, type Locale } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type {
  PostPurchaseTransactionPayload,
  PostPurchaseTransactionResult,
  PurchasePaymentMethod,
  PurchasePaymentStatus,
  PurchaseProductOption,
  Supplier,
} from '../../shared/ipc/dto';
import { downloadPurchaseReceiptXlsx } from './purchaseReceiptExport';

interface LineItem {
  id: string;
  variantId: number;
  unitId: number;
  quantity: string;
  unitCost: string;
}

interface AdditionalCostItem {
  id: string;
  costType: string;
  amount: string;
}

const UI_COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'New Purchase',
    subtitle: 'Record received goods and supplier payment in one transaction.',
    draftBadge: 'Draft',
    purNumberNotice: 'PUR number generated after save',
    supplier: 'Supplier',
    supplierPlaceholder: 'Select active supplier...',
    supplierDocId: 'Supplier document reference',
    supplierDocIdOptional: '(Optional)',
    supplierDocIdPlaceholder: 'e.g. FA-2026-8871 (Optional)',
    docDate: 'Date',
    productLines: 'Products & Quantities',
    addProduct: '+ Add Product',
    productPickerTitle: 'Select Product from Catalog',
    productPlaceholder: 'Search product, variant, SKU or barcode...',
    unit: 'Unit',
    qty: 'Qty',
    unitCost: 'Unit Cost',
    lineTotal: 'Total',
    removeLine: 'Remove',
    noProductsAdded: 'No products added yet. Add the first item from the catalog.',
    noProductsFound: 'No products match your search query.',
    additionalCostsTitle: 'Additional Costs',
    additionalCostsSubtitle: 'Transport, freight, customs, loading',
    addAdditionalCost: '+ Add Cost',
    costType: 'Description (e.g. Transport, Customs)',
    costAmount: 'Amount (DZD)',
    paymentSection: 'Payment',
    paymentStatus: 'Payment status',
    paymentMethod: 'Payment method',
    paidStatus: 'Paid (Full)',
    partiallyPaidStatus: 'Partially Paid',
    unpaidStatus: 'Unpaid',
    cashMethod: 'Cash',
    bankMethod: 'Bank Transfer',
    paidAmount: 'Paid now',
    remainingAmount: 'Remaining',
    printAfterConfirmation: 'Print after confirmation',
    printHint: 'Uses default printer format configured in Settings.',
    summaryTitle: 'Summary',
    subtotal: 'Subtotal',
    additionalCosts: 'Additional costs',
    grandTotal: 'GRAND TOTAL',
    paidNow: 'Paid now',
    remaining: 'Remaining',
    confirmPurchase: 'Confirm Purchase',
    confirmTitle: 'Confirm Purchase Transaction',
    confirmMsg: 'Please review the transaction summary before confirming.',
    cancel: 'Cancel',
    successTitle: 'Purchase Completed Successfully',
    printReceipt: 'Print Receipt',
    exportExcel: 'Export Excel (.xlsx)',
    viewReceipt: 'View Documents',
    newPurchase: 'New Purchase',
    duplicateDocError: 'This supplier document number has already been recorded for the selected supplier.',
    cashSessionError: 'An active open cash session is required to post cash payments to suppliers.',
    noSupplierSelected: 'Please select a supplier.',
    invalidLineCost: 'Please enter a valid purchase cost (≥ 0) for all line items.',
    unitUWholeError: 'Quantity for unit U must be a whole number.',
    loadSuppliersError: 'Failed to load suppliers. Please check database connection.',
    loadProductsError: 'Failed to load product catalog. Please retry.',
    retry: 'Retry',
  },
  fr: {
    title: 'Nouveau Reçu d’Achat',
    subtitle: 'Enregistrer les marchandises reçues et le paiement fournisseur en une seule transaction.',
    draftBadge: 'Brouillon',
    purNumberNotice: 'N° PUR généré après enregistrement',
    supplier: 'Fournisseur',
    supplierPlaceholder: 'Sélectionner un fournisseur actif...',
    supplierDocId: 'N° Document Fournisseur',
    supplierDocIdOptional: '(Optionnel)',
    supplierDocIdPlaceholder: 'ex. FA-2026-8871 (Optionnel)',
    docDate: 'Date',
    productLines: 'Produits & Quantités',
    addProduct: '+ Ajouter un produit',
    productPickerTitle: 'Sélectionner un Produit du Catalogue',
    productPlaceholder: 'Rechercher produit, variante, SKU ou code-barres...',
    unit: 'Unité',
    qty: 'Qté',
    unitCost: 'Coût Unitaire',
    lineTotal: 'Total',
    removeLine: 'Supprimer',
    noProductsAdded: 'Aucun produit ajouté. Ajoutez le premier produit du catalogue.',
    noProductsFound: 'Aucun produit ne correspond à votre recherche.',
    additionalCostsTitle: 'Frais Annexes',
    additionalCostsSubtitle: 'Transport, fret, douane, manutention',
    addAdditionalCost: '+ Ajouter des frais',
    costType: 'Description (ex. Transport, Douane)',
    costAmount: 'Montant (DZD)',
    paymentSection: 'Paiement',
    paymentStatus: 'Statut du paiement',
    paymentMethod: 'Mode de paiement',
    paidStatus: 'Payé (Total)',
    partiallyPaidStatus: 'Partiellement Payé',
    unpaidStatus: 'Non Payé',
    cashMethod: 'Espèces',
    bankMethod: 'Virement Bancaire',
    paidAmount: 'Payé maintenant',
    remainingAmount: 'Reste à payer',
    printAfterConfirmation: 'Imprimer après confirmation',
    printHint: 'Utilise le format d’imprimante configuré dans Paramètres.',
    summaryTitle: 'Récapitulatif',
    subtotal: 'Sous-total',
    additionalCosts: 'Frais annexes',
    grandTotal: 'GRAND TOTAL',
    paidNow: 'Payé maintenant',
    remaining: 'Reste',
    confirmPurchase: 'Confirmer l’Achat',
    confirmTitle: 'Confirmer la Transaction d’Achat',
    confirmMsg: 'Veuillez vérifier le récapitulatif de la transaction avant de confirmer.',
    cancel: 'Annuler',
    successTitle: 'Achat Effectué avec Succès',
    printReceipt: 'Imprimer le Reçu',
    exportExcel: 'Exporter Excel (.xlsx)',
    viewReceipt: 'Voir le Document',
    newPurchase: 'Nouvel Achat',
    duplicateDocError: 'Ce N° de document a déjà été enregistré pour ce fournisseur.',
    cashSessionError: 'Une session de caisse ouverte est requise pour effectuer un paiement en espèces.',
    noSupplierSelected: 'Veuillez sélectionner un fournisseur.',
    invalidLineCost: 'Veuillez saisir un coût d’achat valide (≥ 0) pour toutes les lignes.',
    unitUWholeError: 'La quantité pour l’unité U doit être un nombre entier.',
    loadSuppliersError: 'Impossible de charger les fournisseurs.',
    loadProductsError: 'Impossible de charger le catalogue produits.',
    retry: 'Réessayer',
  },
  ar: {
    title: 'وصل شراء جديد',
    subtitle: 'تسجيل البضائع المستلمة والدفع للمورد في عملية واحدة.',
    draftBadge: 'مسودة',
    purNumberNotice: 'يتم توليد رقم PUR بعد الحفظ',
    supplier: 'المورد',
    supplierPlaceholder: 'اختر موردًا نشطًا...',
    supplierDocId: 'مرجع وثيقة المورد',
    supplierDocIdOptional: '(اختياري)',
    supplierDocIdPlaceholder: 'مثال: FA-2026-8871 (اختياري)',
    docDate: 'التاريخ',
    productLines: 'المنتجات والكميات',
    addProduct: '+ إضافة منتج',
    productPickerTitle: 'اختر منتجاً من الكتالوج',
    productPlaceholder: 'بحث بالمنتج، المتغير، SKU أو الباركود...',
    unit: 'الوحدة',
    qty: 'الكمية',
    unitCost: 'سعر الفردي',
    lineTotal: 'المجموع',
    removeLine: 'حذف',
    noProductsAdded: 'لم يتم إضافة أي منتج بعد. أضف المنتج الأول من الكتالوج.',
    noProductsFound: 'لا توجد منتجات تطابق بحثك.',
    additionalCostsTitle: 'مصاريف إضافية',
    additionalCostsSubtitle: 'النقل، الشحن، الجمرك، التحميل',
    addAdditionalCost: '+ إضافة مصاريف',
    costType: 'الوصف (مثال: النقل، الجمرك)',
    costAmount: 'المبلغ (د.ج)',
    paymentSection: 'الدفع',
    paymentStatus: 'حالة الدفع',
    paymentMethod: 'طريقة الدفع',
    paidStatus: 'مدفوع بالكامل',
    partiallyPaidStatus: 'مدفوع جزئيًا',
    unpaidStatus: 'غير مدفوع',
    cashMethod: 'نقداً',
    bankMethod: 'تحويل بنكي',
    paidAmount: 'المدفوع الآن',
    remainingAmount: 'المتبقي',
    printAfterConfirmation: 'طباعة بعد التأكيد',
    printHint: 'تستخدم نسق الطابعة المحدد في الإعدادات.',
    summaryTitle: 'الملخص',
    subtotal: 'المجموع الفرعي',
    additionalCosts: 'مصاريف إضافية',
    grandTotal: 'المجموع الكلي',
    paidNow: 'المدفوع الآن',
    remaining: 'المتبقي',
    confirmPurchase: 'تأكيد الشراء',
    confirmTitle: 'تأكيد عملية الشراء',
    confirmMsg: 'يرجى مراجعة ملخص العملية قبل التأكيد.',
    cancel: 'إلغاء',
    successTitle: 'تمت عملية الشراء بنجاح',
    printReceipt: 'طباعة الوصل',
    exportExcel: 'تصدير إكسل (.xlsx)',
    viewReceipt: 'عرض الوثائق',
    newPurchase: 'شراء جديد',
    duplicateDocError: 'تم تسجيل رقم وثيقة المورد هذا من قبل لهذا المورد.',
    cashSessionError: 'يجب فتح جلسة صندوق نشطة قبل دفع المورد نقداً.',
    noSupplierSelected: 'يرجى اختيار مورد.',
    invalidLineCost: 'يرجى إدخال سعر شراء صحيح لجميع المنتجات.',
    unitUWholeError: 'يجب أن تكون الكمية للوحدة U عدداً صحيحاً.',
    loadSuppliersError: 'تعذر تحميل قائمة الموردين.',
    loadProductsError: 'تعذر تحميل كتالوج المنتجات.',
    retry: 'إعادة المحاولة',
  },
};

function formatMoney(val: number): string {
  if (isNaN(val) || Math.abs(val) < 0.0001) return '0.00 DZD';
  return `${val.toFixed(2)} DZD`;
}

export function PurchaseTransactionScreen({ sessionToken }: { sessionToken: string }) {
  const { locale } = useI18n();
  const copy = UI_COPY[locale] || UI_COPY.en;
  const getErrorText = useErrorText();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [productOptions, setProductOptions] = useState<PurchaseProductOption[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');

  // Header State
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | ''>('');
  const [externalSupplierDocNum, setExternalSupplierDocNum] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Lines State
  const [lines, setLines] = useState<LineItem[]>([]);

  // Additional Costs State
  const [additionalCostsOpen, setAdditionalCostsOpen] = useState(false);
  const [additionalCosts, setAdditionalCosts] = useState<AdditionalCostItem[]>([]);

  // Payment State
  const [paymentStatus, setPaymentStatus] = useState<PurchasePaymentStatus>('PAID');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('CASH');
  const [paidAmountInput, setPaidAmountInput] = useState('');

  // Print State
  const [printAfterConfirmation, setPrintAfterConfirmation] = useState(true);

  // Modal & Success State
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [postedResult, setPostedResult] = useState<PostPurchaseTransactionResult | null>(null);

  const supplierSelectRef = useRef<HTMLSelectElement>(null);
  const docIdInputRef = useRef<HTMLInputElement>(null);
  const pickerSearchInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setFormError(null);

    const [supResult, prodResult] = await Promise.allSettled([
      ipc.listSuppliers(sessionToken, false),
      ipc.listPurchaseProductOptions(sessionToken),
    ]);

    let hasErr = false;

    if (supResult.status === 'fulfilled') {
      setSuppliers(supResult.value);
    } else {
      hasErr = true;
      setFormError(getErrorText(supResult.reason) || copy.loadSuppliersError);
    }

    if (prodResult.status === 'fulfilled') {
      setProductOptions(prodResult.value);
    } else if (!hasErr) {
      setFormError(getErrorText(prodResult.reason) || copy.loadProductsError);
    }

    setLoading(false);
  }, [sessionToken, getErrorText, copy.loadSuppliersError, copy.loadProductsError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const addLineFromOption = useCallback((opt: PurchaseProductOption) => {
    setLines((prev) => {
      const existingIdx = prev.findIndex((l) => l.variantId === opt.variant_id);
      if (existingIdx >= 0) {
        // Increment quantity instead of duplicating variant line
        const updated = [...prev];
        const currentQty = parseFloat(updated[existingIdx].quantity) || 0;
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: String(Math.floor(currentQty + 1)),
        };
        return updated;
      }

      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          variantId: opt.variant_id,
          unitId: opt.default_unit_id,
          quantity: '1',
          unitCost: '',
        },
      ];
    });
  }, []);

  const addLineDefault = useCallback(() => {
    setProductPickerOpen(true);
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const updateLine = useCallback(
    (id: string, updates: Partial<LineItem>) => {
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const updated = { ...l, ...updates };
          if (updates.variantId) {
            const opt = productOptions.find((p) => p.variant_id === updates.variantId);
            if (opt) updated.unitId = opt.default_unit_id;
          }
          return updated;
        })
      );
    },
    [productOptions]
  );

  const addAdditionalCost = useCallback(() => {
    setAdditionalCosts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), costType: 'Transport', amount: '0' },
    ]);
  }, []);

  const removeAdditionalCost = useCallback((id: string) => {
    setAdditionalCosts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const updateAdditionalCost = useCallback((id: string, updates: Partial<AdditionalCostItem>) => {
    setAdditionalCosts((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  }, []);

  // Filtered products for modal picker
  const filteredPickerProducts = useMemo(() => {
    if (!productSearchQuery.trim()) return productOptions;
    const q = productSearchQuery.toLowerCase().trim();
    return productOptions.filter((p) => {
      const vName = (p.variant_name || '').toLowerCase();
      const pName = p.product_name.toLowerCase();
      const sku = p.sku.toLowerCase();
      const barcode = (p.primary_barcode || '').toLowerCase();
      const brand = p.brand ? p.brand.name.toLowerCase() : '';
      const attrs = p.attributes.map((a) => `${a.name} ${a.value}`.toLowerCase()).join(' ');

      return (
        pName.includes(q) ||
        vName.includes(q) ||
        sku.includes(q) ||
        barcode.includes(q) ||
        brand.includes(q) ||
        attrs.includes(q)
      );
    });
  }, [productOptions, productSearchQuery]);

  // Financial calculations
  const calculations = useMemo(() => {
    let subtotal = 0;

    for (const l of lines) {
      const qty = parseFloat(l.quantity) || 0;
      const cost = parseFloat(l.unitCost) || 0;
      subtotal += qty * cost;
    }

    let addCosts = 0;
    for (const c of additionalCosts) {
      addCosts += parseFloat(c.amount) || 0;
    }

    const grandTotal = Math.max(0, subtotal + addCosts);

    let paidNow = 0;
    if (paymentStatus === 'PAID') {
      paidNow = grandTotal;
    } else if (paymentStatus === 'PARTIALLY_PAID') {
      paidNow = parseFloat(paidAmountInput) || 0;
    } else {
      paidNow = 0;
    }

    const remaining = Math.max(0, grandTotal - paidNow);

    return {
      subtotal,
      addCosts,
      grandTotal,
      paidNow,
      remaining,
    };
  }, [lines, additionalCosts, paymentStatus, paidAmountInput]);

  function validateBeforeModal() {
    setFormError(null);
    if (!selectedSupplierId) {
      setFormError(copy.noSupplierSelected);
      supplierSelectRef.current?.focus();
      return;
    }
    if (lines.length === 0) {
      setFormError(copy.noProductsAdded);
      return;
    }
    for (const l of lines) {
      const cost = parseFloat(l.unitCost);
      if (isNaN(cost) || cost < 0 || l.unitCost.trim() === '') {
        setFormError(copy.invalidLineCost);
        return;
      }
      const opt = productOptions.find((p) => p.variant_id === l.variantId);
      const isUnitU = opt ? opt.default_unit_code === 'U' : true;
      if (isUnitU) {
        const qtyNum = parseFloat(l.quantity);
        if (isNaN(qtyNum) || qtyNum <= 0 || !Number.isInteger(qtyNum)) {
          setFormError(copy.unitUWholeError);
          return;
        }
      }
    }
    setConfirmModalOpen(true);
  }

  async function handleConfirmSubmit() {
    setConfirmModalOpen(false);
    setSubmitting(true);
    setFormError(null);

    try {
      const docRefTrimmed = externalSupplierDocNum.trim();
      const payload: PostPurchaseTransactionPayload = {
        request_id: ipc.newRequestId(),
        supplier_id: Number(selectedSupplierId),
        document_date: documentDate,
        external_supplier_document_number: docRefTrimmed ? docRefTrimmed : null,
        payment_status: paymentStatus,
        payment_method: paymentStatus !== 'UNPAID' ? paymentMethod : null,
        paid_amount: paymentStatus === 'PARTIALLY_PAID' ? paidAmountInput : null,
        print_after_confirmation: printAfterConfirmation,
        note: null,
        lines: lines.map((l) => ({
          variant_id: l.variantId,
          unit_id: l.unitId,
          quantity: l.quantity,
          unit_cost: l.unitCost,
        })),
        additional_costs: additionalCosts.length > 0
          ? additionalCosts.map((c) => ({ cost_type: c.costType, amount: c.amount }))
          : null,
      };

      const result = await ipc.postPurchaseTransaction(sessionToken, payload);
      setPostedResult(result);
    } catch (err: unknown) {
      const text = getErrorText(err);
      if (text.includes('DUPLICATE_SUPPLIER_DOCUMENT')) {
        setFormError(copy.duplicateDocError);
      } else if (text.includes('CASH_SESSION_REQUIRED')) {
        setFormError(copy.cashSessionError);
      } else {
        setFormError(text);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleNewPurchaseReset() {
    setPostedResult(null);
    setLines([]);
    setAdditionalCosts([]);
    setExternalSupplierDocNum('');
    setPaidAmountInput('');
    setFormError(null);
  }

  function handleExportExcel() {
    if (!postedResult) return;
    const selectedSupplier = suppliers.find((s) => s.id === Number(selectedSupplierId));
    downloadPurchaseReceiptXlsx({
      documentNumber: postedResult.document_number,
      documentDate: documentDate,
      supplierName: selectedSupplier?.name || 'Supplier',
      supplierDocRef: externalSupplierDocNum.trim(),
      paymentStatus: postedResult.payment_status,
      paymentMethod: postedResult.payment_method || 'N/A',
      subtotal: postedResult.gross_subtotal,
      additionalCosts: String(calculations.addCosts),
      grandTotal: postedResult.total_amount,
      paidAmount: postedResult.paid_amount,
      remainingAmount: postedResult.outstanding_amount,
      lines: lines.map((l, idx) => {
        const opt = productOptions.find((p) => p.variant_id === l.variantId);
        const qtyNum = parseFloat(l.quantity) || 0;
        const costNum = parseFloat(l.unitCost) || 0;
        return {
          lineNumber: idx + 1,
          sku: opt?.sku || 'SKU-000',
          productName: opt?.product_name || 'Product',
          variantName: opt?.variant_name || undefined,
          barcode: opt?.primary_barcode || undefined,
          unitCode: opt?.default_unit_code || 'PCS',
          quantity: qtyNum,
          unitCost: costNum,
          lineTotal: qtyNum * costNum,
        };
      }),
    });
  }

  // Keyboard Shortcuts Listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault();
        setProductPickerOpen(true);
      } else if (e.key === 'F4') {
        e.preventDefault();
        supplierSelectRef.current?.focus();
      } else if (e.key === 'F12') {
        e.preventDefault();
        validateBeforeModal();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSupplierId, externalSupplierDocNum, lines, paymentStatus]);

  useEffect(() => {
    if (productPickerOpen) {
      setTimeout(() => pickerSearchInputRef.current?.focus(), 50);
    }
  }, [productPickerOpen]);

  if (loading) {
    return (
      <div className="sk-centered">
        <Spinner />
      </div>
    );
  }

  if (postedResult) {
    return (
      <div className="sk-purchase-container">
        <div className="sk-purchase-section" style={{ borderColor: 'var(--sk-ok)', background: 'var(--sk-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <h1 style={{ color: 'var(--sk-ok)', margin: 0 }}>✓ {copy.successTitle}</h1>
            <span className="sk-badge sk-badge--ok" style={{ fontSize: '0.95rem', padding: '6px 14px' }}>
              {postedResult.document_number}
            </span>
          </div>

          <div className="sk-detail-dialog__grid" style={{ marginTop: '12px' }}>
            <div className="sk-detail-dialog__field sk-detail-dialog__field--highlight">
              <span className="sk-detail-dialog__field-label">{copy.grandTotal}</span>
              <span className="sk-detail-dialog__field-val--money">{formatMoney(parseFloat(postedResult.total_amount))}</span>
            </div>
            <div className="sk-detail-dialog__field">
              <span className="sk-detail-dialog__field-label">{copy.paymentStatus}</span>
              <span className="sk-detail-dialog__field-val">
                {postedResult.payment_status} {postedResult.payment_method ? `(${postedResult.payment_method})` : ''}
              </span>
            </div>
            <div className="sk-detail-dialog__field">
              <span className="sk-detail-dialog__field-label">{copy.paidNow}</span>
              <span className="sk-detail-dialog__field-val" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(parseFloat(postedResult.paid_amount))}
              </span>
            </div>
            <div className="sk-detail-dialog__field">
              <span className="sk-detail-dialog__field-label">{copy.remaining}</span>
              <span className="sk-detail-dialog__field-val" style={{ fontVariantNumeric: 'tabular-nums', color: postedResult.outstanding_amount !== '0.00' ? 'var(--sk-warn)' : 'var(--sk-ok)' }}>
                {formatMoney(parseFloat(postedResult.outstanding_amount))}
              </span>
            </div>
          </div>

          {postedResult.print_status === 'FAILED' && (
            <Banner tone="warning">
              Purchase posted successfully, but receipt thermal printer was offline. You can reprint anytime from Documents.
            </Banner>
          )}

          <div className="sk-form-actions" style={{ marginTop: '16px' }}>
            <Button type="button" onClick={() => window.print()}>
              {copy.printReceipt}
            </Button>
            <Button type="button" variant="secondary" onClick={handleExportExcel}>
              {copy.exportExcel}
            </Button>
            <Button type="button" variant="secondary" onClick={handleNewPurchaseReset}>
              {copy.newPurchase}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const selectedSupplier = suppliers.find((s) => s.id === Number(selectedSupplierId));

  return (
    <div className="sk-purchase-container">
      {/* Header */}
      <header className="sk-purchase-header">
        <div className="sk-purchase-header__titles">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1>{copy.title}</h1>
            <span className="sk-badge sk-badge--neutral">{copy.draftBadge}</span>
            <span className="sk-muted" style={{ fontSize: '0.78rem' }}>• {copy.purNumberNotice}</span>
          </div>
          <p>{copy.subtitle}</p>
        </div>
        <div className="sk-purchase-header__shortcuts">
          <span className="sk-shortcut-pill"><kbd>F2</kbd> Product Picker</span>
          <span className="sk-shortcut-pill"><kbd>F4</kbd> Supplier Focus</span>
          <span className="sk-shortcut-pill"><kbd>F12</kbd> Confirm</span>
        </div>
      </header>

      {formError && (
        <Banner tone="error">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>{formError}</span>
            <Button type="button" variant="secondary" className="sk-button--small" onClick={loadData}>
              {copy.retry}
            </Button>
          </div>
        </Banner>
      )}

      {/* Transaction Header Info Card */}
      <section className="sk-purchase-section">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 45%) minmax(180px, 35%) minmax(130px, 20%)', gap: 16 }}>
          <div className="sk-field">
            <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'space-between', justifyContent: 'space-between' }}>
              <label htmlFor="purchase-supplier-select">{copy.supplier} *</label>
              {selectedSupplier && (
                <span className="sk-muted" style={{ fontSize: '0.74rem', fontStyle: 'italic' }}>
                  {selectedSupplier.code} {selectedSupplier.tax_id ? `| NIF: ${selectedSupplier.tax_id}` : ''}
                </span>
              )}
            </div>
            <select
              id="purchase-supplier-select"
              ref={supplierSelectRef}
              className="sk-field__input"
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">{copy.supplierPlaceholder}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>

          <div className="sk-field">
            <label htmlFor="supplier-doc-id-input">
              {copy.supplierDocId} <span className="sk-muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>{copy.supplierDocIdOptional}</span>
            </label>
            <input
              id="supplier-doc-id-input"
              ref={docIdInputRef}
              type="text"
              className="sk-field__input"
              placeholder={copy.supplierDocIdPlaceholder}
              value={externalSupplierDocNum}
              onChange={(e) => setExternalSupplierDocNum(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="doc-date-input">{copy.docDate}</label>
            <input
              id="doc-date-input"
              type="date"
              className="sk-field__input"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Products & Line Items Editor (Read-Only Selected Variant Line Cards) */}
      <section className="sk-purchase-section">
        <div className="sk-purchase-section__title">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2>{copy.productLines}</h2>
            <span className="sk-badge sk-badge--info">{lines.length} items</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button type="button" variant="secondary" onClick={addLineDefault}>
              {copy.addProduct}
            </Button>
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="sk-empty-card" style={{ padding: '24px 16px', margin: 0, gap: 6 }}>
            <p className="sk-empty-card__title" style={{ fontSize: '0.95rem' }}>{copy.noProductsAdded}</p>
            <p className="sk-empty-card__sub" style={{ fontSize: '0.82rem' }}>
              Click <strong style={{ color: 'var(--sk-primary)' }}>+ Add Product</strong> above or press <kbd style={{ padding: '2px 6px', background: 'var(--sk-surface-soft)', border: '1px solid var(--sk-border)', borderRadius: '4px' }}>F2</kbd> to add items from the catalog.
            </p>
          </div>
        ) : (
          <div className="sk-purchase-table-wrap">
            <table className="sk-purchase-table">
              <thead>
                <tr>
                  <th style={{ width: '45%' }}>Product / Variant</th>
                  <th style={{ width: '15%' }}>{copy.unit}</th>
                  <th style={{ width: '15%' }}>{copy.qty}</th>
                  <th style={{ width: '15%' }}>{copy.unitCost}</th>
                  <th style={{ width: '10%' }} className="sk-num">{copy.lineTotal}</th>
                  <th style={{ width: '3%' }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const lineGross = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitCost) || 0);
                  const currentOpt = productOptions.find((p) => p.variant_id === line.variantId);
                  const isUnitU = currentOpt ? currentOpt.default_unit_code === 'U' : true;

                  const displayName = currentOpt
                    ? (currentOpt.variant_name && currentOpt.variant_name !== currentOpt.product_name
                        ? `${currentOpt.product_name} - ${currentOpt.variant_name}`
                        : currentOpt.product_name).replace(/Â·/g, '-').replace(/·/g, '-')
                    : 'Selected Variant';

                  return (
                    <tr key={line.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontWeight: 750, color: 'var(--sk-text)' }}>
                            {displayName} {currentOpt?.brand ? `[${currentOpt.brand.name}]` : ''}
                          </span>
                          <span className="sk-muted" style={{ fontSize: '0.78rem' }}>
                            SKU: {currentOpt?.sku || '—'} {currentOpt?.primary_barcode ? `| Barcode: ${currentOpt.primary_barcode}` : ''}
                          </span>
                        </div>
                      </td>
                      <td>
                        <select
                          className="sk-field__input"
                          value={line.unitId}
                          onChange={(e) => updateLine(line.id, { unitId: Number(e.target.value) })}
                        >
                          {currentOpt && (
                            <>
                              <option value={currentOpt.default_unit_id}>
                                {currentOpt.default_unit_code}
                              </option>
                              {currentOpt.alternate_units.map((alt) => (
                                <option key={alt.unit_id} value={alt.unit_id}>
                                  {alt.unit_code} (x{alt.conversion_factor})
                                </option>
                              ))}
                            </>
                          )}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step={isUnitU ? '1' : '0.001'}
                          min="1"
                          className="sk-field__input"
                          style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                          value={line.quantity}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="sk-field__input"
                          style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                          placeholder="0.00"
                          value={line.unitCost}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateLine(line.id, { unitCost: e.target.value })}
                        />
                      </td>
                      <td className="sk-num" style={{ fontWeight: 800, color: 'var(--sk-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(lineGross)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="sk-cart__remove"
                          title={copy.removeLine}
                          onClick={() => removeLine(line.id)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Two-Column Desktop Layout */}
      <div className="sk-purchase-summary-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Payment Pane */}
          <section className="sk-purchase-section">
            <h2 className="sk-purchase-section__title" style={{ fontSize: '0.98rem' }}>{copy.paymentSection}</h2>

            <div className="sk-field">
              <label>{copy.paymentStatus}</label>
              <div className="sk-segmented-toggle">
                <button
                  type="button"
                  className={`sk-segmented-toggle__btn ${paymentStatus === 'PAID' ? 'sk-segmented-toggle__btn--active' : ''}`}
                  onClick={() => setPaymentStatus('PAID')}
                >
                  {copy.paidStatus}
                </button>
                <button
                  type="button"
                  className={`sk-segmented-toggle__btn ${paymentStatus === 'PARTIALLY_PAID' ? 'sk-segmented-toggle__btn--active' : ''}`}
                  onClick={() => setPaymentStatus('PARTIALLY_PAID')}
                >
                  {copy.partiallyPaidStatus}
                </button>
                <button
                  type="button"
                  className={`sk-segmented-toggle__btn ${paymentStatus === 'UNPAID' ? 'sk-segmented-toggle__btn--active' : ''}`}
                  onClick={() => setPaymentStatus('UNPAID')}
                >
                  {copy.unpaidStatus}
                </button>
              </div>
            </div>

            {paymentStatus !== 'UNPAID' && (
              <div className="sk-field">
                <label>{copy.paymentMethod}</label>
                <div className="sk-segmented-toggle">
                  <button
                    type="button"
                    className={`sk-segmented-toggle__btn ${paymentMethod === 'CASH' ? 'sk-segmented-toggle__btn--active' : ''}`}
                    onClick={() => setPaymentMethod('CASH')}
                  >
                    {copy.cashMethod}
                  </button>
                  <button
                    type="button"
                    className={`sk-segmented-toggle__btn ${paymentMethod === 'BANK_TRANSFER' ? 'sk-segmented-toggle__btn--active' : ''}`}
                    onClick={() => setPaymentMethod('BANK_TRANSFER')}
                  >
                    {copy.bankMethod}
                  </button>
                </div>
              </div>
            )}

            {paymentStatus === 'PARTIALLY_PAID' && (
              <div className="sk-purchase-grid-2">
                <div className="sk-field">
                  <label htmlFor="purchase-paid-amount">{copy.paidAmount} *</label>
                  <input
                    id="purchase-paid-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    className="sk-field__input"
                    placeholder="0.00"
                    style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                    value={paidAmountInput}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setPaidAmountInput(e.target.value)}
                  />
                </div>
                <div className="sk-field">
                  <label>{copy.remainingAmount}</label>
                  <div className="sk-field__input" style={{ background: 'var(--sk-surface-soft)', fontWeight: 700, color: calculations.remaining > 0 ? 'var(--sk-warn)' : 'var(--sk-ok)', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center' }}>
                    {formatMoney(calculations.remaining)}
                  </div>
                </div>
              </div>
            )}

            {/* Print preference toggle */}
            <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--sk-border)' }}>
              <label className="sk-switch">
                <input
                  type="checkbox"
                  checked={printAfterConfirmation}
                  onChange={(e) => setPrintAfterConfirmation(e.target.checked)}
                />
                <span className="sk-switch__track" aria-hidden>
                  <span className="sk-switch__thumb" />
                </span>
                <div>
                  <div style={{ fontWeight: 650 }}>{copy.printAfterConfirmation}</div>
                  <div className="sk-muted" style={{ fontSize: '0.75rem' }}>{copy.printHint}</div>
                </div>
              </label>
            </div>
          </section>

          {/* Additional Costs Section */}
          <section className="sk-purchase-section" style={{ padding: '16px 20px' }}>
            <div
              onClick={() => setAdditionalCostsOpen(!additionalCostsOpen)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 750, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{additionalCostsOpen ? '▼' : '►'} {copy.additionalCostsTitle}</span>
                  {additionalCosts.length > 0 && (
                    <span className="sk-badge sk-badge--info">+{formatMoney(calculations.addCosts)} ({additionalCosts.length})</span>
                  )}
                </h3>
                <p className="sk-muted" style={{ margin: '2px 0 0', fontSize: '0.76rem' }}>{copy.additionalCostsSubtitle}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="sk-button--small"
                onClick={(e) => {
                  e.stopPropagation();
                  setAdditionalCostsOpen(true);
                  addAdditionalCost();
                }}
              >
                {copy.addAdditionalCost}
              </Button>
            </div>

            {additionalCostsOpen && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {additionalCosts.length === 0 ? (
                  <p className="sk-muted" style={{ margin: 0, fontSize: '0.82rem' }}>No landed costs added. Click "+ Add Cost" for freight, customs, or transit charges.</p>
                ) : (
                  additionalCosts.map((c) => (
                    <div key={c.id} className="sk-purchase-grid-3" style={{ alignItems: 'center', gridTemplateColumns: '1.4fr 1fr auto' }}>
                      <input
                        type="text"
                        className="sk-field__input"
                        placeholder={copy.costType}
                        value={c.costType}
                        onChange={(e) => updateAdditionalCost(c.id, { costType: e.target.value })}
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="sk-field__input"
                        style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                        placeholder={copy.costAmount}
                        value={c.amount}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateAdditionalCost(c.id, { amount: e.target.value })}
                      />
                      <Button type="button" variant="danger" className="sk-button--small" onClick={() => removeAdditionalCost(c.id)}>
                        ✕
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </div>

        {/* Right Sticky Summary Card */}
        <section className="sk-purchase-summary-card sk-purchase-summary-card--sticky">
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, paddingBottom: 8, borderBottom: '1px solid var(--sk-border)' }}>
            {copy.summaryTitle}
          </h2>

          <div className="sk-purchase-summary-row">
            <span>{copy.subtotal}</span>
            <strong>{formatMoney(calculations.subtotal)}</strong>
          </div>
          <div className="sk-purchase-summary-row">
            <span>{copy.additionalCosts}</span>
            <strong>{formatMoney(calculations.addCosts)}</strong>
          </div>

          <div className="sk-purchase-summary-row sk-purchase-summary-row--grand">
            <span>{copy.grandTotal}</span>
            <strong>{formatMoney(calculations.grandTotal)}</strong>
          </div>

          <div className="sk-purchase-summary-row">
            <span>{copy.paidNow}</span>
            <strong style={{ color: 'var(--sk-primary)' }}>{formatMoney(calculations.paidNow)}</strong>
          </div>
          <div className="sk-purchase-summary-row">
            <span>{copy.remaining}</span>
            <strong style={{ color: calculations.remaining > 0 ? 'var(--sk-warn)' : 'var(--sk-ok)' }}>
              {formatMoney(calculations.remaining)}
            </strong>
          </div>

          <div style={{ marginTop: 10 }}>
            <Button
              type="button"
              style={{ width: '100%', minHeight: 46, fontSize: '0.98rem' }}
              disabled={submitting}
              onClick={validateBeforeModal}
            >
              {submitting ? <Spinner /> : copy.confirmPurchase}
            </Button>
          </div>
        </section>
      </div>

      {/* Product Picker Modal */}
      {productPickerOpen && (
        <div className="sk-modal__backdrop" role="presentation" onClick={() => setProductPickerOpen(false)}>
          <div
            className="sk-modal sk-modal-content--large"
            role="dialog"
            aria-modal="true"
            aria-label={copy.productPickerTitle}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(100%, 780px)' }}
          >
            <div className="sk-modal-header">
              <div>
                <h2 className="sk-modal__title" style={{ fontSize: '1.15rem' }}>{copy.productPickerTitle}</h2>
                <p className="sk-muted" style={{ margin: '3px 0 0', fontSize: '0.8rem' }}>
                  Click any item below to add it to the purchase lines.
                </p>
              </div>
              <button type="button" className="sk-modal-close" onClick={() => setProductPickerOpen(false)}>✕</button>
            </div>

            <div style={{ paddingBlock: 12 }}>
              <input
                ref={pickerSearchInputRef}
                type="text"
                className="sk-field__input"
                placeholder={copy.productPlaceholder}
                value={productSearchQuery}
                onChange={(e) => setProductSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredPickerProducts.length === 0 ? (
                <p className="sk-muted" style={{ padding: 24, textAlign: 'center' }}>{copy.noProductsFound}</p>
              ) : (
                filteredPickerProducts.map((p) => {
                  const displayName = p.variant_name && p.variant_name !== p.product_name
                    ? `${p.product_name} - ${p.variant_name}`
                    : p.product_name;
                  const cleanDisplayName = displayName.replace(/Â·/g, '-').replace(/·/g, '-');

                  return (
                    <div
                      key={p.variant_id}
                      onClick={() => {
                        addLineFromOption(p);
                        setProductPickerOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        border: '1px solid var(--sk-border)',
                        borderRadius: 'var(--sk-radius-sm)',
                        background: 'var(--sk-surface-soft)',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s, border-color 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--sk-primary)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--sk-border)')}
                    >
                      <div>
                        <div style={{ fontWeight: 750, color: 'var(--sk-text)' }}>
                          {cleanDisplayName} {p.brand ? `[${p.brand.name}]` : ''}
                        </div>
                        <div className="sk-muted" style={{ fontSize: '0.78rem' }}>
                          SKU: {p.sku} {p.primary_barcode ? `| Barcode: ${p.primary_barcode}` : ''} {p.attributes.length > 0 ? `| ${p.attributes.map((a) => `${a.name}: ${a.value}`).join(', ')}` : ''}
                        </div>
                      </div>
                      <Button type="button" variant="secondary" className="sk-button--small">
                        + Select
                      </Button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="sk-modal__actions" style={{ marginTop: 16 }}>
              <Button type="button" variant="secondary" onClick={() => setProductPickerOpen(false)}>
                {copy.cancel}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog Modal */}
      {confirmModalOpen && (
        <ConfirmDialog
          title={copy.confirmTitle}
          confirmLabel={copy.confirmPurchase}
          cancelLabel={copy.cancel}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setConfirmModalOpen(false)}
          body={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, color: 'var(--sk-text-soft)' }}>{copy.confirmMsg}</p>
              <div className="sk-detail-dialog__grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="sk-detail-dialog__field">
                  <span className="sk-detail-dialog__field-label">{copy.supplier}</span>
                  <span className="sk-detail-dialog__field-val">{selectedSupplier?.name}</span>
                </div>
                <div className="sk-detail-dialog__field">
                  <span className="sk-detail-dialog__field-label">{copy.supplierDocId}</span>
                  <span className="sk-detail-dialog__field-val">{externalSupplierDocNum.trim() || '— (None)'}</span>
                </div>
                <div className="sk-detail-dialog__field">
                  <span className="sk-detail-dialog__field-label">{copy.productLines}</span>
                  <span className="sk-detail-dialog__field-val">{lines.length} items</span>
                </div>
                <div className="sk-detail-dialog__field sk-detail-dialog__field--highlight">
                  <span className="sk-detail-dialog__field-label">{copy.grandTotal}</span>
                  <span className="sk-detail-dialog__field-val--money">{formatMoney(calculations.grandTotal)}</span>
                </div>
                <div className="sk-detail-dialog__field">
                  <span className="sk-detail-dialog__field-label">{copy.paymentStatus}</span>
                  <span className="sk-detail-dialog__field-val">
                    {paymentStatus} {paymentStatus !== 'UNPAID' ? `(${paymentMethod})` : ''}
                  </span>
                </div>
                <div className="sk-detail-dialog__field">
                  <span className="sk-detail-dialog__field-label">{copy.remaining}</span>
                  <span className="sk-detail-dialog__field-val">{formatMoney(calculations.remaining)}</span>
                </div>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
