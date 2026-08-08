import { useEffect, useMemo, useState } from 'react';

import { Banner, Button, ConfirmDialog, TextField } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type {
  HistoricalFinanceSummaryResult,
  HistoricalFinanceValidationResult,
  HistoricalPaymentStatus,
  HistoricalTransactionType,
  HistoricalTradeAnalyticsResult,
  HistoricalTradeValidationResult,
} from '../../shared/ipc/onboardingDto';
import {
  approveHistoricalFinanceBatch,
  approveHistoricalTradeBatch,
  createHistoricalFinanceBatch,
  createHistoricalTradeBatch,
  getHistoricalFinanceSetting,
  getHistoricalFinanceSummary,
  getHistoricalTradeAnalytics,
  replaceHistoricalFinanceBatchData,
  replaceHistoricalTradeBatchData,
  updateHistoricalFinanceSetting,
  validateHistoricalFinanceBatch,
  validateHistoricalTradeBatch,
} from '../../shared/ipc/onboardingGateway';
import {
  parseHistoricalFinanceWorkbook,
  parsePaperBookWorkbook,
  type HistoricalFinanceWorkbookData,
  type PaperBookWorkbookData,
} from './xlsxParser';

interface Props {
  sessionToken: string;
}

type BusyAction =
  | 'setting'
  | 'parse'
  | 'import'
  | 'approve'
  | 'manual'
  | 'summary'
  | 'analytics'
  | null;

type AnalyticsSubTab =
  | 'overview'
  | 'sales'
  | 'purchases'
  | 'products'
  | 'brands'
  | 'parties'
  | 'quality'
  | 'overrides';

interface ManualDraft {
  paperId: string;
  transactionDate: string;
  transactionType: HistoricalTransactionType;
  descriptionOrCategory: string;
  netAmountDzd: string;
  paymentStatus: HistoricalPaymentStatus;
  amountPaidDzd: string;
  expenseCategory: string;
  supplierFournisseur: string;
  customerClient: string;
  notes: string;
}

const EMPTY_MANUAL: ManualDraft = {
  paperId: '',
  transactionDate: '',
  transactionType: 'SALE',
  descriptionOrCategory: '',
  netAmountDzd: '',
  paymentStatus: 'PAID',
  amountPaidDzd: '',
  expenseCategory: '',
  supplierFournisseur: '',
  customerClient: '',
  notes: '',
};

const TRANSACTION_TYPES: HistoricalTransactionType[] = [
  'SALE',
  'PURCHASE',
  'EXPENSE',
  'OTHER_INCOME',
  'CUSTOMER_REFUND',
  'SUPPLIER_REFUND',
  'LOAN_RECEIVED',
  'LOAN_REPAYMENT',
  'OWNER_CONTRIBUTION',
  'OWNER_WITHDRAWAL',
  'TAX_PAYMENT',
  'SALARY',
  'OTHER',
];

const PAYMENT_STATUSES: HistoricalPaymentStatus[] = [
  'PAID',
  'UNPAID',
  'PARTIAL',
  'UNKNOWN',
];

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Historical finance onboarding',
    subtitle: 'Import the 1.5-year finance history from the official Excel template or enter a missing paper manually.',
    safety: 'Historical data is staged for review and reporting only. It does not create live sales, purchases, stock, cash, receivables, payables, or journal entries.',
    enabled: 'Historical finance import enabled',
    enabledHelp: 'CEO/administrator control. It is ON by default and blocks new batches when disabled.',
    paperBookTitle: 'Primary path — Paper-Book 1.5-Year XLSX Import (BUY / SELL)',
    paperBookHelp: 'Use the official Stockiha paper-book template with Transactions sheet. Formula values in Line Total are recalculated independently.',
    excelTitle: 'Secondary path — Generic Excel import (R0-001)',
    excelHelp: 'Use the generic Stockiha workbook with Historical_Transactions and Balances sheets.',
    chooseFile: 'Choose .xlsx workbook',
    fileReady: 'Workbook parsed successfully.',
    transactions: 'Transaction rows',
    balances: 'Balance rows',
    errors: 'Workbook errors',
    importValidate: 'Stage and validate workbook',
    validated: 'The batch is clean and ready for approval.',
    needsReview: 'The batch contains validation issues and cannot be approved yet.',
    approve: 'Approve for historical reporting',
    approved: 'Historical batch approved for reporting.',
    manualTitle: 'Secondary path — manual entry',
    manualHelp: 'Use this for a missing paper or a correction batch. Product details are not required.',
    paperId: 'Paper ID',
    date: 'Transaction date',
    type: 'Transaction type',
    description: 'Description or category',
    amount: 'Net amount (DZD)',
    paymentStatus: 'Payment status',
    amountPaid: 'Amount paid (optional)',
    expenseCategory: 'Expense category (optional)',
    supplier: 'Supplier / Fournisseur (optional)',
    customer: 'Customer / Client (optional)',
    notes: 'Notes (optional)',
    saveManual: 'Stage and validate manual row',
    manualSaved: 'Manual row staged and validated.',
    summaryTitle: 'Historical finance summary',
    summaryHelp: 'Only approved historical batches are included.',
    dateFrom: 'From date',
    dateTo: 'To date',
    analyticsDateFrom: 'Analytics from date',
    analyticsDateTo: 'Analytics to date',
    loadSummary: 'Calculate summary',
    sales: 'Sales',
    purchases: 'Purchases',
    expenses: 'Expenses',
    otherIncome: 'Other income',
    preliminary: 'Preliminary result before inventory',
    inventoryAdjusted: 'Estimated profit / loss',
    inventoryMissing: 'Opening and closing inventory values are missing. The preliminary result is not exact accounting profit.',
    inventoryComplete: 'Opening and closing inventory values were applied. The result remains an historical estimate, not certified accounts.',
    invalidManual: 'Complete the required manual fields with a positive whole-DZD amount.',
    parseFailed: 'The workbook could not be read. Use the official Stockiha template and correct the reported problem.',
    analyticsTitle: '1.5-Year Trade Analytics Dashboard',
    analyticsHelp: 'Comprehensive multi-dimensional analytics for approved paper-book trade records.',
    profitWarning: 'Recorded trade difference — not accounting profit',
    profitWarningDetail: 'Purchases can remain in inventory. True accounting profit requires opening/closing inventory valuation.',
    loadAnalytics: 'Compute Trade Analytics',
    tradeDifference: 'Recorded Trade Difference (Sales - Purchases)',
  },
  fr: {
    title: 'Intégration financière historique',
    subtitle: 'Importer 1,5 an d’historique financier depuis le modèle Excel officiel ou saisir manuellement un document manquant.',
    safety: 'Les données historiques sont préparées uniquement pour contrôle et reporting. Elles ne créent aucune vente, achat, stock, caisse, créance, dette ou écriture comptable active.',
    enabled: 'Import financier historique activé',
    enabledHelp: 'Contrôle du PDG/administrateur. Activé par défaut et bloque les nouveaux lots lorsqu’il est désactivé.',
    paperBookTitle: 'Chemin principal — Import Registre Papier 1,5 An (ACHAT / VENTE)',
    paperBookHelp: 'Utilisez le modèle officiel avec la feuille Transactions. Les formules dans Total Ligne sont recalculées.',
    excelTitle: 'Chemin secondaire — Import Excel générique (R0-001)',
    excelHelp: 'Utilisez le classeur générique avec les feuilles Historical_Transactions et Balances.',
    chooseFile: 'Choisir le classeur .xlsx',
    fileReady: 'Classeur analysé avec succès.',
    transactions: 'Lignes de transactions',
    balances: 'Lignes de soldes',
    errors: 'Erreurs du classeur',
    importValidate: 'Préparer et valider le classeur',
    validated: 'Le lot est valide et prêt pour approbation.',
    needsReview: 'Le lot contient des erreurs et ne peut pas être approuvé.',
    approve: 'Approuver pour le reporting historique',
    approved: 'Lot historique approuvé pour le reporting.',
    manualTitle: 'Chemin secondaire — saisie manuelle',
    manualHelp: 'À utiliser pour un document manquant ou un lot de correction. Les détails produits ne sont pas requis.',
    paperId: 'Identifiant du papier',
    date: 'Date de transaction',
    type: 'Type de transaction',
    description: 'Description ou catégorie',
    amount: 'Montant net (DZD)',
    paymentStatus: 'État du paiement',
    amountPaid: 'Montant payé (facultatif)',
    expenseCategory: 'Catégorie de dépense (facultatif)',
    supplier: 'Fournisseur (facultatif)',
    customer: 'Client (facultatif)',
    notes: 'Notes (facultatif)',
    saveManual: 'Préparer et valider la ligne',
    manualSaved: 'Ligne manuelle préparée et validée.',
    summaryTitle: 'Résumé financier historique',
    summaryHelp: 'Seuls les lots historiques approuvés sont inclus.',
    dateFrom: 'Date de début',
    dateTo: 'Date de fin',
    loadSummary: 'Calculer le résumé',
    sales: 'Ventes',
    purchases: 'Achats',
    expenses: 'Dépenses',
    otherIncome: 'Autres revenus',
    preliminary: 'Résultat préliminaire avant stock',
    inventoryAdjusted: 'Bénéfice / perte estimé',
    inventoryMissing: 'Les valeurs de stock initial et final manquent. Le résultat préliminaire n’est pas un bénéfice comptable exact.',
    inventoryComplete: 'Les valeurs de stock initial et final ont été appliquées. Le résultat reste une estimation historique.',
    invalidManual: 'Complétez les champs obligatoires avec un montant entier DZD positif.',
    parseFailed: 'Le classeur ne peut pas être lu. Utilisez le modèle Stockiha officiel et corrigez le problème signalé.',
    analyticsTitle: 'Tableau de Bord Analytique Historique',
    analyticsHelp: 'Analytique multidimensionnelle pour les enregistrements du registre papier approuvés.',
    profitWarning: 'Écart d’opérations enregistrées — pas un bénéfice comptable',
    profitWarningDetail: 'Les achats peuvent rester en stock. Le bénéfice réel exige l’évaluation du stock initial et final.',
    loadAnalytics: 'Calculer l’analytique',
    tradeDifference: 'Écart Ventes - Achats enregistrés',
  },
  ar: {
    title: 'إدخال البيانات المالية التاريخية',
    subtitle: 'استيراد السجل المالي لمدة سنة ونصف من ملف Excel الرسمي أو إدخال ورقة ناقصة يدوياً.',
    safety: 'تُحفظ البيانات التاريخية للمراجعة والتقارير فقط. لا تنشئ مبيعات أو مشتريات أو مخزوناً أو حركة صندوق أو ديوناً أو قيوداً محاسبية مباشرة.',
    enabled: 'تفعيل استيراد البيانات المالية التاريخية',
    enabledHelp: 'إعداد المدير/المسؤول. مفعّل افتراضياً ويمنع إنشاء دفعات جديدة عند تعطيله.',
    paperBookTitle: 'المسار الرئيسي — استيراد سجل الورق (شراء / بيع)',
    paperBookHelp: 'استعمل ملف سجل الورق الرسمي مع ورقة Transactions.',
    excelTitle: 'المسار الثانوي — استيراد Excel العام (R0-001)',
    excelHelp: 'استعمل ملف Stockiha العام الذي يحتوي على Historical_Transactions وBalances.',
    chooseFile: 'اختيار ملف .xlsx',
    fileReady: 'تمت قراءة الملف بنجاح.',
    transactions: 'أسطر المعاملات',
    balances: 'أسطر الأرصدة',
    errors: 'أخطاء الملف',
    importValidate: 'حفظ الملف مؤقتاً والتحقق منه',
    validated: 'الدفعة سليمة وجاهزة للموافقة.',
    needsReview: 'تحتوي الدفعة على أخطاء ولا يمكن الموافقة عليها بعد.',
    approve: 'الموافقة للتقارير التاريخية',
    approved: 'تمت الموافقة على الدفعة للتقارير التاريخية.',
    manualTitle: 'المسار الثانوي — إدخال يدوي',
    manualHelp: 'لورقة ناقصة أو دفعة تصحيح. تفاصيل المنتجات غير مطلوبة.',
    paperId: 'معرّف الورقة',
    date: 'تاريخ المعاملة',
    type: 'نوع المعاملة',
    description: 'الوصف أو التصنيف',
    amount: 'المبلغ الصافي (دج)',
    paymentStatus: 'حالة الدفع',
    amountPaid: 'المبلغ المدفوع (اختياري)',
    expenseCategory: 'تصنيف المصروف (اختياري)',
    supplier: 'المورد / Fournisseur (اختياري)',
    customer: 'الزبون / Client (اختياري)',
    notes: 'ملاحظات (اختياري)',
    saveManual: 'حفظ السطر والتحقق منه',
    manualSaved: 'تم حفظ السطر اليدوي والتحقق منه.',
    summaryTitle: 'الملخص المالي التاريخي',
    summaryHelp: 'تدخل في الحساب الدفعات التي تمت الموافقة عليها فقط.',
    dateFrom: 'من تاريخ',
    dateTo: 'إلى تاريخ',
    loadSummary: 'حساب الملخص',
    sales: 'المبيعات',
    purchases: 'المشتريات',
    expenses: 'المصاريف',
    otherIncome: 'مداخيل أخرى',
    preliminary: 'النتيجة الأولية قبل المخزون',
    inventoryAdjusted: 'الربح / الخسارة التقديرية',
    inventoryMissing: 'قيمة مخزون البداية والنهاية غير متوفرة. النتيجة الأولية ليست ربحاً محاسبياً دقيقاً.',
    inventoryComplete: 'تم احتساب مخزون البداية والنهاية. تبقى النتيجة تقديراً تاريخياً وليست حسابات مصادقاً عليها.',
    invalidManual: 'أكمل الحقول الإجبارية بمبلغ صحيح وموجب بالدينار.',
    parseFailed: 'تعذر قراءة الملف. استعمل قالب Stockiha الرسمي وصحح الخطأ المعروض.',
    analyticsTitle: 'لوحة تحليلات المعاملات التاريخية',
    analyticsHelp: 'تحليل المعاملات التاريخية المعتمدة خلال الفترة المحددة.',
    profitWarning: 'فارق المعاملات المسجلة — ليس ربحاً محاسبياً',
    profitWarningDetail: 'المشتريات قد تبقى في المخزون. الربح المحاسبي الدقيق يتطلب تقييم مخزون البداية والنهاية.',
    loadAnalytics: 'حساب التحليلات التاريخية',
    tradeDifference: 'فارق المبيعات - المشتريات المسجلة',
  },
};

let requestSequence = 0;
function nextRequestId(source: string): string {
  requestSequence += 1;
  return `historical-${source}-${Date.now()}-${requestSequence}`;
}

function formatMoney(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(locale).format(value)} DZD`;
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseWholeAmount(value: string, allowEmpty = false): number | null {
  const normalized = value.replace(/[\s,]/g, '');
  if (allowEmpty && normalized === '') return null;
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function HistoricalFinanceScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();

  const [busy, setBusy] = useState<BusyAction>(null);
  const [enabled, setEnabled] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generic R0-001 Excel State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<HistoricalFinanceWorkbookData | null>(null);
  const [validation, setValidation] = useState<HistoricalFinanceValidationResult | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);

  // Paper Book R0-002 State
  const [pbFile, setPbFile] = useState<File | null>(null);
  const [pbData, setPbData] = useState<PaperBookWorkbookData | null>(null);
  const [pbValidation, setPbValidation] = useState<HistoricalTradeValidationResult | null>(null);
  const [pbActiveBatchId, setPbActiveBatchId] = useState<number | null>(null);

  // Analytics & Summary State
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [summary, setSummary] = useState<HistoricalFinanceSummaryResult | null>(null);
  const [analytics, setAnalytics] = useState<HistoricalTradeAnalyticsResult | null>(null);
  const [analyticsSubTab, setAnalyticsSubTab] = useState<AnalyticsSubTab>('overview');
  const [showApproveConfirmModal, setShowApproveConfirmModal] = useState(false);

  // Manual Draft State
  const [manual, setManual] = useState<ManualDraft>(EMPTY_MANUAL);

  useEffect(() => {
    let cancelled = false;
    void getHistoricalFinanceSetting(sessionToken)
      .then((result) => {
        if (!cancelled) setEnabled(result.enabled);
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorText(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken, errorText]);

  const canImportGeneric = useMemo(
    () =>
      enabled &&
      workbook !== null &&
      workbook.errors.length === 0 &&
      workbook.rows.length > 0 &&
      busy === null,
    [enabled, workbook, busy],
  );

  const canImportPaperBook = useMemo(
    () =>
      enabled &&
      pbData !== null &&
      pbData.errors.length === 0 &&
      pbData.transactions.length > 0 &&
      busy === null,
    [enabled, pbData, busy],
  );

  async function toggleEnabled(nextEnabled: boolean) {
    if (busy) return;
    setBusy('setting');
    setError(null);
    setFeedback(null);
    try {
      const result = await updateHistoricalFinanceSetting(sessionToken, {
        enabled: nextEnabled,
      });
      setEnabled(result.enabled);
    } catch (settingError) {
      setError(errorText(settingError));
    } finally {
      setBusy(null);
    }
  }

  async function selectWorkbook(file: File | null) {
    setSelectedFile(file);
    setWorkbook(null);
    setValidation(null);
    setActiveBatchId(null);
    setError(null);
    setFeedback(null);
    if (!file) return;

    setBusy('parse');
    try {
      const parsed = await parseHistoricalFinanceWorkbook(file);
      setWorkbook(parsed);
      if (parsed.errors.length === 0) setFeedback(text.fileReady);
    } catch (parseError) {
      setError(
        `${text.parseFailed} ${parseError instanceof Error ? parseError.message : ''}`.trim(),
      );
    } finally {
      setBusy(null);
    }
  }

  async function loadAnalytics(customFrom?: string, customTo?: string) {
    const f = customFrom || dateFrom;
    const t = customTo || dateTo;
    if (!f || !t || busy !== null) return;
    setBusy('analytics');
    setError(null);
    try {
      const res = await getHistoricalTradeAnalytics(sessionToken, { dateFrom: f, dateTo: t });
      setAnalytics(res as unknown as HistoricalTradeAnalyticsResult);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function selectPaperBookFile(file: File | null) {
    setPbFile(file);
    setPbData(null);
    setPbValidation(null);
    setPbActiveBatchId(null);
    setError(null);
    setFeedback(null);
    if (!file) return;

    setBusy('parse');
    try {
      const parsed = await parsePaperBookWorkbook(file);
      setPbData(parsed);
      if (parsed.errors.length === 0) {
        setFeedback(text.fileReady);
        const fromDate = parsed.summary.minDate ?? '2025-01-01';
        const toDate = parsed.summary.maxDate ?? '2026-12-31';
        setDateFrom(fromDate);
        setDateTo(toDate);
        void loadAnalytics(fromDate, toDate);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paper-Book parse error');
    } finally {
      setBusy(null);
    }
  }

  async function stageAndValidateExcel() {
    if (!canImportGeneric || !selectedFile || !workbook) return;
    setBusy('import');
    setError(null);
    setFeedback(null);
    setValidation(null);
    try {
      const batch = await createHistoricalFinanceBatch(sessionToken, {
        requestId: nextRequestId('excel'),
        sourceType: 'EXCEL',
        originalFilename: selectedFile.name,
      });
      setActiveBatchId(batch.batchId);
      await replaceHistoricalFinanceBatchData(sessionToken, {
        batchId: batch.batchId,
        rows: workbook.rows,
        balances: workbook.balances,
      });
      const checked = await validateHistoricalFinanceBatch(sessionToken, {
        batchId: batch.batchId,
      });
      setValidation(checked);
      setFeedback(checked.status === 'VALIDATED' ? text.validated : text.needsReview);
    } catch (importError) {
      setError(errorText(importError));
    } finally {
      setBusy(null);
    }
  }

  async function stageAndValidatePaperBook() {
    if (!canImportPaperBook || !pbFile || !pbData) return;
    setBusy('import');
    setError(null);
    setFeedback(null);
    setPbValidation(null);

    try {
      const batch = await createHistoricalTradeBatch(sessionToken, {
        requestId: nextRequestId('paperbook'),
        originalFilename: pbFile.name,
        contentHash: pbData.contentHash,
      });
      setPbActiveBatchId(batch.batchId);

      await replaceHistoricalTradeBatchData(sessionToken, {
        batchId: batch.batchId,
        transactions: pbData.transactions,
      });

      const checked = await validateHistoricalTradeBatch(sessionToken, {
        batchId: batch.batchId,
      });

      setPbValidation(checked);
      setFeedback(checked.status === 'VALIDATED' ? text.validated : text.needsReview);

      const f = dateFrom || pbData.summary.minDate || '2025-01-01';
      const t = dateTo || pbData.summary.maxDate || '2026-12-31';
      if (!dateFrom) setDateFrom(f);
      if (!dateTo) setDateTo(t);
      void loadAnalytics(f, t);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function approveGeneric() {
    if (!activeBatchId || validation?.status !== 'VALIDATED' || busy) return;
    setBusy('approve');
    setError(null);
    setFeedback(null);
    try {
      await approveHistoricalFinanceBatch(sessionToken, { batchId: activeBatchId });
      setFeedback(text.approved);
    } catch (approvalError) {
      setError(errorText(approvalError));
    } finally {
      setBusy(null);
    }
  }

  async function approvePaperBook() {
    if (!pbActiveBatchId || pbValidation?.status !== 'VALIDATED' || busy) return;
    setBusy('approve');
    setError(null);
    setFeedback(null);
    try {
      await approveHistoricalTradeBatch(sessionToken, { batchId: pbActiveBatchId });
      setFeedback(text.approved);
      if (dateFrom && dateTo) void loadAnalytics(dateFrom, dateTo);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function stageManual() {
    if (busy || !enabled) return;
    const netAmount = parseWholeAmount(manual.netAmountDzd);
    const amountPaid = parseWholeAmount(manual.amountPaidDzd, true);
    if (
      !manual.paperId.trim() ||
      !manual.transactionDate ||
      !manual.descriptionOrCategory.trim() ||
      netAmount === null ||
      netAmount <= 0 ||
      (manual.amountPaidDzd.trim() !== '' && amountPaid === null)
    ) {
      setError(text.invalidManual);
      return;
    }

    setBusy('manual');
    setError(null);
    setFeedback(null);
    setValidation(null);
    try {
      const batch = await createHistoricalFinanceBatch(sessionToken, {
        requestId: nextRequestId('manual'),
        sourceType: 'MANUAL',
        originalFilename: null,
      });
      setActiveBatchId(batch.batchId);
      await replaceHistoricalFinanceBatchData(sessionToken, {
        batchId: batch.batchId,
        rows: [
          {
            sourceRowNumber: 2,
            paperId: manual.paperId.trim(),
            transactionDate: manual.transactionDate,
            transactionType: manual.transactionType,
            descriptionOrCategory: manual.descriptionOrCategory.trim(),
            netAmountDzd: netAmount,
            paymentStatus: manual.paymentStatus,
            amountPaidDzd: amountPaid,
            expenseCategory: optional(manual.expenseCategory),
            supplierFournisseur: optional(manual.supplierFournisseur),
            customerClient: optional(manual.customerClient),
            notes: optional(manual.notes),
            reviewStatus: 'READY',
          },
        ],
        balances: [],
      });
      const checked = await validateHistoricalFinanceBatch(sessionToken, {
        batchId: batch.batchId,
      });
      setValidation(checked);
      setFeedback(checked.status === 'VALIDATED' ? text.manualSaved : text.needsReview);
      if (checked.status === 'VALIDATED') setManual(EMPTY_MANUAL);
    } catch (manualError) {
      setError(errorText(manualError));
    } finally {
      setBusy(null);
    }
  }

  async function loadSummary() {
    if (!dateFrom || !dateTo || busy) return;
    setBusy('summary');
    setError(null);
    setSummary(null);
    try {
      setSummary(
        await getHistoricalFinanceSummary(sessionToken, {
          dateFrom,
          dateTo,
        }),
      );
    } catch (summaryError) {
      setError(errorText(summaryError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sk-page" aria-labelledby="historical-finance-heading">
      {/* HEADER & SAFETY CARD */}
      <div className="sk-card" style={{ borderInlineStart: '4px solid var(--sk-primary)', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h1 id="historical-finance-heading" style={{ margin: '0 0 6px 0', fontSize: '1.5rem', fontWeight: 800 }}>
              {text.title}
            </h1>
            <p style={{ margin: 0, color: 'var(--sk-muted)', fontSize: '0.92rem' }}>{text.subtitle}</p>
          </div>
          <div className="sk-field" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label className="sk-field__label" htmlFor="toggle-import-enabled" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700 }}>
              <input
                id="toggle-import-enabled"
                type="checkbox"
                checked={enabled}
                disabled={busy !== null}
                onChange={(event) => void toggleEnabled(event.target.checked)}
              />
              {text.enabled}
            </label>
          </div>
        </div>
        <div style={{ marginTop: '16px' }}>
          <Banner tone="warning">{text.safety}</Banner>
          {error ? <Banner tone="error">{error}</Banner> : null}
          {feedback ? <Banner tone="success">{feedback}</Banner> : null}
        </div>
      </div>

      {/* R0-002 PAPER-BOOK 1.5-YEAR XLSX IMPORT CARD */}
      <div className="sk-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBlockEnd: '16px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '1.2rem', fontWeight: 800 }}>{text.paperBookTitle}</h2>
            <p style={{ margin: 0, color: 'var(--sk-muted)', fontSize: '0.88rem' }}>{text.paperBookHelp}</p>
          </div>
          {pbValidation ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '0.78rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background:
                  pbValidation.status === 'VALIDATED'
                    ? 'color-mix(in srgb, #10B981 15%, transparent)'
                    : 'color-mix(in srgb, #F59E0B 15%, transparent)',
                color:
                  pbValidation.status === 'VALIDATED'
                    ? '#10B981'
                    : '#F59E0B',
              }}
            >
              ● Batch {pbValidation.status}
            </span>
          ) : null}
        </div>

        <div className="sk-field">
          <label className="sk-field__label" htmlFor="paperbook-xlsx-file">
            Select Paper-Book Workbook (.xlsx)
          </label>
          <input
            id="paperbook-xlsx-file"
            className="sk-field__input"
            type="file"
            accept=".xlsx"
            disabled={!enabled || busy !== null}
            onChange={(e) => void selectPaperBookFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {pbData ? (
          <div className="sk-cards" style={{ marginTop: '16px' }} data-testid="paperbook-preview">
            <div className="sk-metric" style={{ minHeight: 'auto', padding: '16px' }}>
              <span className="sk-metric__icon">📋</span>
              <span className="sk-metric__label">{text.transactions}</span>
              <span className="sk-metric__value" style={{ fontSize: '1.6rem' }}>{pbData.summary.transactionCount}</span>
            </div>
            <div className="sk-metric" style={{ minHeight: 'auto', padding: '16px' }}>
              <span className="sk-metric__icon">📦</span>
              <span className="sk-metric__label">Product Lines</span>
              <span className="sk-metric__value" style={{ fontSize: '1.6rem' }}>{pbData.summary.lineCount}</span>
            </div>
            <div className="sk-metric" style={{ minHeight: 'auto', padding: '16px' }}>
              <span className="sk-metric__icon">💵</span>
              <span className="sk-metric__label">{text.sales}</span>
              <span className="sk-metric__value" style={{ fontSize: '1.4rem', color: '#10B981' }}>
                {formatMoney(pbData.summary.totalSalesDzd, locale)}
              </span>
            </div>
            <div className="sk-metric" style={{ minHeight: 'auto', padding: '16px' }}>
              <span className="sk-metric__icon">🛒</span>
              <span className="sk-metric__label">{text.purchases}</span>
              <span className="sk-metric__value" style={{ fontSize: '1.4rem', color: '#3B82F6' }}>
                {formatMoney(pbData.summary.totalPurchasesDzd, locale)}
              </span>
            </div>
          </div>
        ) : null}

        {pbData?.errors.length ? (
          <div className="sk-banner sk-banner--error" role="alert" style={{ marginTop: '16px' }}>
            <strong>{text.errors} ({pbData.errors.length})</strong>
            <ul style={{ margin: '8px 0 0 0', paddingInlineStart: '20px' }}>
              {pbData.errors.map((item, index) => (
                <li key={index}>
                  Row {item.row} · {item.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
          <Button
            type="button"
            loading={busy === 'import'}
            disabled={!canImportPaperBook}
            onClick={() => void stageAndValidatePaperBook()}
          >
            Stage and validate paper-book batch
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={busy === 'approve'}
            disabled={pbValidation?.status !== 'VALIDATED' || busy !== null}
            onClick={() => setShowApproveConfirmModal(true)}
          >
            Approve paper-book batch
          </Button>
        </div>

        {showApproveConfirmModal ? (
          <ConfirmDialog
            title="Approve Paper-Book Batch for Reporting"
            body={`Are you sure you want to approve batch #${pbActiveBatchId}? Approved trade records will be permanently available in 1.5-year trade reporting.`}
            confirmLabel="Confirm Approval"
            cancelLabel="Cancel"
            confirmVariant="primary"
            busy={busy === 'approve'}
            onConfirm={async () => {
              setShowApproveConfirmModal(false);
              await approvePaperBook();
            }}
            onCancel={() => setShowApproveConfirmModal(false)}
          />
        ) : null}

        {pbValidation ? (
          <div style={{ marginTop: '20px', padding: '16px', background: 'var(--sk-surface-soft)', borderRadius: 'var(--sk-radius)', border: '1px solid var(--sk-border)' }} data-testid="paperbook-validation-result">
            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 800 }}>Validation Summary Result</h4>
            <div className="sk-cards">
              <div>
                <span className="sk-muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', fontWeight: 700 }}>Paid Sales</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#10B981' }}>{formatMoney(pbValidation.paidSalesDzd, locale)}</div>
              </div>
              <div>
                <span className="sk-muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', fontWeight: 700 }}>Unpaid Sales</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#F59E0B' }}>{formatMoney(pbValidation.unpaidSalesDzd, locale)}</div>
              </div>
              <div>
                <span className="sk-muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', fontWeight: 700 }}>Paid Purchases</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#3B82F6' }}>{formatMoney(pbValidation.paidPurchasesDzd, locale)}</div>
              </div>
              <div>
                <span className="sk-muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', fontWeight: 700 }}>Unpaid Purchases</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#8B5CF6' }}>{formatMoney(pbValidation.unpaidPurchasesDzd, locale)}</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* R0-002 TRADE ANALYTICS DASHBOARD CARD */}
      <div className="sk-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBlockEnd: '16px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', fontWeight: 800 }}>{text.analyticsTitle}</h2>
            <p style={{ margin: 0, color: 'var(--sk-muted)', fontSize: '0.88rem' }}>{text.analyticsHelp}</p>
          </div>
          {analytics ? (
            <span style={{ fontSize: '0.82rem', fontWeight: 700, padding: '4px 10px', borderRadius: '14px', background: 'var(--sk-primary-soft)', color: 'var(--sk-primary)' }}>
              Analytics Computed for {analytics.overview.dateFrom} → {analytics.overview.dateTo}
            </span>
          ) : null}
        </div>

        <div className="sk-form-grid">
          <TextField
            label={text.analyticsDateFrom}
            type="date"
            value={dateFrom}
            disabled={busy !== null}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <TextField
            label={text.analyticsDateTo}
            type="date"
            value={dateTo}
            disabled={busy !== null}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            type="button"
            variant="primary"
            loading={busy === 'analytics'}
            disabled={!dateFrom || !dateTo || busy !== null}
            onClick={() => void loadAnalytics()}
          >
            {text.loadAnalytics}
          </Button>
          {pbData?.summary.minDate && pbData?.summary.maxDate ? (
            <button
              type="button"
              className="sk-button sk-button--secondary"
              style={{ fontSize: '0.82rem', padding: '6px 12px' }}
              onClick={() => {
                const minD = pbData.summary.minDate!;
                const maxD = pbData.summary.maxDate!;
                setDateFrom(minD);
                setDateTo(maxD);
                void loadAnalytics(minD, maxD);
              }}
            >
              Preset: Batch Range ({pbData.summary.minDate} → {pbData.summary.maxDate})
            </button>
          ) : null}
        </div>

        {analytics ? (
          <div style={{ marginTop: '24px' }}>
            <Banner tone="info">
              <strong>⚠️ {text.profitWarning}: </strong>
              {text.profitWarningDetail}
            </Banner>

            {/* Overview KPI Cards */}
            <div className="sk-cards" style={{ marginBlock: '20px' }}>
              <div className="sk-metric" style={{ background: 'color-mix(in srgb, #10B981 6%, var(--sk-surface-soft))' }}>
                <span className="sk-metric__icon" style={{ background: 'color-mix(in srgb, #10B981 15%, transparent)', color: '#10B981' }}>📈</span>
                <span className="sk-metric__label">Total Sales</span>
                <span className="sk-metric__value" style={{ color: '#10B981', fontSize: '1.65rem' }}>
                  {formatMoney(analytics.overview.totalSalesDzd, locale)}
                </span>
                <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--sk-muted)', marginTop: '4px' }}>
                  Paid: {formatMoney(analytics.overview.paidSalesDzd, locale)} · Unpaid: {formatMoney(analytics.overview.unpaidSalesDzd, locale)}
                </div>
              </div>

              <div className="sk-metric" style={{ background: 'color-mix(in srgb, #3B82F6 6%, var(--sk-surface-soft))' }}>
                <span className="sk-metric__icon" style={{ background: 'color-mix(in srgb, #3B82F6 15%, transparent)', color: '#3B82F6' }}>🛒</span>
                <span className="sk-metric__label">Total Purchases</span>
                <span className="sk-metric__value" style={{ color: '#3B82F6', fontSize: '1.65rem' }}>
                  {formatMoney(analytics.overview.totalPurchasesDzd, locale)}
                </span>
                <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--sk-muted)', marginTop: '4px' }}>
                  Paid: {formatMoney(analytics.overview.paidPurchasesDzd, locale)} · Unpaid: {formatMoney(analytics.overview.unpaidPurchasesDzd, locale)}
                </div>
              </div>

              <div className="sk-metric" style={{ background: 'color-mix(in srgb, var(--sk-primary) 6%, var(--sk-surface-soft))' }}>
                <span className="sk-metric__icon">⚖️</span>
                <span className="sk-metric__label">{text.tradeDifference}</span>
                <span className="sk-metric__value" style={{ fontSize: '1.65rem', color: analytics.overview.tradeDifferenceDzd >= 0 ? '#10B981' : '#EF4444' }}>
                  {formatMoney(analytics.overview.tradeDifferenceDzd, locale)}
                </span>
                <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--sk-muted)', marginTop: '4px' }}>
                  Avg Sale: {formatMoney(analytics.overview.avgSaleValueDzd, locale)} · Avg Purchase: {formatMoney(analytics.overview.avgPurchaseValueDzd, locale)}
                </div>
              </div>

              <div className="sk-metric">
                <span className="sk-metric__icon">📊</span>
                <span className="sk-metric__label">Data Volume & Coverage</span>
                <span className="sk-metric__value" style={{ fontSize: '1.65rem' }}>
                  {analytics.overview.transactionCount} <span style={{ fontSize: '0.9rem', color: 'var(--sk-muted)' }}>txns / {analytics.overview.lineCount} lines</span>
                </span>
                <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--sk-muted)', marginTop: '4px' }}>
                  Party Name Coverage: {analytics.dataQuality.partyCoveragePct.toFixed(0)}%
                </div>
              </div>
            </div>

            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: '6px', margin: '20px 0 16px 0', overflowX: 'auto', borderBottom: '1px solid var(--sk-border)', paddingBottom: '10px' }}>
              {(['overview', 'sales', 'purchases', 'products', 'brands', 'parties', 'quality', 'overrides'] as AnalyticsSubTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  style={{
                    textTransform: 'capitalize',
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    borderRadius: 'var(--sk-radius)',
                    border: '1px solid',
                    borderColor: analyticsSubTab === tab ? 'var(--sk-primary)' : 'var(--sk-border)',
                    background: analyticsSubTab === tab ? 'var(--sk-primary)' : 'var(--sk-surface-soft)',
                    color: analyticsSubTab === tab ? '#fff' : 'var(--sk-text)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => setAnalyticsSubTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* TAB CONTENT: OVERVIEW WITH MONTHLY VISUAL CHART */}
            {analyticsSubTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <MonthlyTrendChart timeline={analytics.timeline} locale={locale} />

                <div className="sk-cards">
                  <div style={{ padding: '16px', borderRadius: 'var(--sk-radius)', background: 'var(--sk-surface-soft)', border: '1px solid var(--sk-border)' }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', fontWeight: 800 }}>Sales Payment Breakdown</h4>
                    <PaymentProgressBar
                      paid={analytics.payment.sales.paid}
                      unpaid={analytics.payment.sales.unpaid}
                      total={analytics.payment.sales.total}
                      locale={locale}
                      paidColor="#10B981"
                      unpaidColor="#F59E0B"
                    />
                  </div>
                  <div style={{ padding: '16px', borderRadius: 'var(--sk-radius)', background: 'var(--sk-surface-soft)', border: '1px solid var(--sk-border)' }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', fontWeight: 800 }}>Purchases Payment Breakdown</h4>
                    <PaymentProgressBar
                      paid={analytics.payment.purchases.paid}
                      unpaid={analytics.payment.purchases.unpaid}
                      total={analytics.payment.purchases.total}
                      locale={locale}
                      paidColor="#3B82F6"
                      unpaidColor="#8B5CF6"
                    />
                  </div>
                </div>
              </div>
            )}

            {analyticsSubTab === 'sales' && (
              <div style={{ padding: '20px', background: 'var(--sk-surface-soft)', borderRadius: 'var(--sk-radius)', border: '1px solid var(--sk-border)' }}>
                <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', fontWeight: 800 }}>Sales & Revenue Analysis</h3>
                <PaymentProgressBar
                  paid={analytics.payment.sales.paid}
                  unpaid={analytics.payment.sales.unpaid}
                  total={analytics.payment.sales.total}
                  locale={locale}
                  paidColor="#10B981"
                  unpaidColor="#F59E0B"
                />
              </div>
            )}

            {analyticsSubTab === 'purchases' && (
              <div style={{ padding: '20px', background: 'var(--sk-surface-soft)', borderRadius: 'var(--sk-radius)', border: '1px solid var(--sk-border)' }}>
                <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', fontWeight: 800 }}>Procurement & Purchases Analysis</h3>
                <PaymentProgressBar
                  paid={analytics.payment.purchases.paid}
                  unpaid={analytics.payment.purchases.unpaid}
                  total={analytics.payment.purchases.total}
                  locale={locale}
                  paidColor="#3B82F6"
                  unpaidColor="#8B5CF6"
                />
              </div>
            )}

            {analyticsSubTab === 'products' && (
              <div style={{ border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-radius)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--sk-surface-soft)', borderBottom: '1px solid var(--sk-border)', textAlign: 'left', fontSize: '0.82rem', textTransform: 'uppercase', color: 'var(--sk-muted)' }}>
                      <th style={{ padding: '12px 16px' }}>Product Name</th>
                      <th style={{ padding: '12px 16px' }}>Matched</th>
                      <th style={{ padding: '12px 16px' }}>Qty Sold</th>
                      <th style={{ padding: '12px 16px' }}>Sales DZD</th>
                      <th style={{ padding: '12px 16px' }}>Qty Purchased</th>
                      <th style={{ padding: '12px 16px' }}>Purchases DZD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.products.map((p, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--sk-border)', fontSize: '0.9rem' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 700 }}>{p.productName}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700, background: p.matchedProductId ? 'color-mix(in srgb, #10B981 15%, transparent)' : 'var(--sk-surface-soft)', color: p.matchedProductId ? '#10B981' : 'var(--sk-muted)' }}>
                            {p.matchedProductId ? 'Matched' : 'Unmatched'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>{p.qtySold}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#10B981' }}>{formatMoney(p.salesDzd, locale)}</td>
                        <td style={{ padding: '12px 16px' }}>{p.qtyPurchased}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#3B82F6' }}>{formatMoney(p.purchasesDzd, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {analyticsSubTab === 'brands' && (
              <div style={{ border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-radius)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--sk-surface-soft)', borderBottom: '1px solid var(--sk-border)', textAlign: 'left', fontSize: '0.82rem', textTransform: 'uppercase', color: 'var(--sk-muted)' }}>
                      <th style={{ padding: '12px 16px' }}>Brand</th>
                      <th style={{ padding: '12px 16px' }}>Sales DZD</th>
                      <th style={{ padding: '12px 16px' }}>Purchases DZD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.brands.map((b, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--sk-border)', fontSize: '0.9rem' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 700 }}>{b.brand}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#10B981' }}>{formatMoney(b.salesDzd, locale)}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#3B82F6' }}>{formatMoney(b.purchasesDzd, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {analyticsSubTab === 'parties' && (
              <div style={{ border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-radius)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--sk-surface-soft)', borderBottom: '1px solid var(--sk-border)', textAlign: 'left', fontSize: '0.82rem', textTransform: 'uppercase', color: 'var(--sk-muted)' }}>
                      <th style={{ padding: '12px 16px' }}>Party / Company</th>
                      <th style={{ padding: '12px 16px' }}>Sales DZD</th>
                      <th style={{ padding: '12px 16px' }}>Purchases DZD</th>
                      <th style={{ padding: '12px 16px' }}>Total Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.parties.map((pty, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--sk-border)', fontSize: '0.9rem' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 700 }}>{pty.partyCompany}</td>
                        <td style={{ padding: '12px 16px', color: '#10B981', fontWeight: 700 }}>{formatMoney(pty.salesDzd, locale)}</td>
                        <td style={{ padding: '12px 16px', color: '#3B82F6', fontWeight: 700 }}>{formatMoney(pty.purchasesDzd, locale)}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 800 }}>{formatMoney(pty.totalVolumeDzd, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {analyticsSubTab === 'quality' && (
              <div className="sk-cards">
                <QualityCard title="Product Name Coverage" pct={analytics.dataQuality.productNameCoveragePct} />
                <QualityCard title="Brand Coverage" pct={analytics.dataQuality.brandCoveragePct} />
                <QualityCard title="Party Coverage" pct={analytics.dataQuality.partyCoveragePct} />
                <QualityCard title="Page Number Coverage" pct={analytics.dataQuality.pageNumberCoveragePct} />
                <QualityCard title="Quantity Coverage" pct={analytics.dataQuality.quantityCoveragePct} />
              </div>
            )}

            {analyticsSubTab === 'overrides' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* System Audit Status Banner */}
                <div
                  style={{
                    padding: '16px 20px',
                    borderRadius: 'var(--sk-radius)',
                    background:
                      analytics.manualOverrides.manualOverrideCount === 0
                        ? 'color-mix(in srgb, #10B981 10%, var(--sk-surface-soft))'
                        : 'color-mix(in srgb, #F59E0B 10%, var(--sk-surface-soft))',
                    border: `1px solid ${
                      analytics.manualOverrides.manualOverrideCount === 0 ? '#10B981' : '#F59E0B'
                    }`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                  }}
                >
                  <span style={{ fontSize: '1.6rem' }}>
                    {analytics.manualOverrides.manualOverrideCount === 0 ? '🟢' : '⚠️'}
                  </span>
                  <div>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '1rem', fontWeight: 800 }}>
                      {analytics.manualOverrides.manualOverrideCount === 0
                        ? 'Pure Mathematical Integrity'
                        : 'Manual Line Overrides Detected'}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--sk-muted)' }}>
                      {analytics.manualOverrides.manualOverrideCount === 0
                        ? `All ${analytics.manualOverrides.calculatedLineCount} product lines follow exact Line Total = Qty × Unit Price mathematical formulas with 0 DZD variance.`
                        : `${analytics.manualOverrides.manualOverrideCount} line(s) use handwritten total overrides with a net difference of ${formatMoney(analytics.manualOverrides.totalOverrideDifferenceDzd, locale)}.`}
                    </p>
                  </div>
                </div>

                {/* 4 Metric Cards Grid */}
                <div className="sk-cards">
                  <div className="sk-metric" style={{ background: 'color-mix(in srgb, #10B981 6%, var(--sk-surface-soft))' }}>
                    <span className="sk-metric__icon" style={{ background: 'color-mix(in srgb, #10B981 15%, transparent)', color: '#10B981' }}>🧮</span>
                    <span className="sk-metric__label">Calculated Formula Lines</span>
                    <span className="sk-metric__value" style={{ fontSize: '1.75rem', color: '#10B981' }}>
                      {analytics.manualOverrides.calculatedLineCount}
                    </span>
                    <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--sk-muted)', marginTop: '4px' }}>
                      Qty × Unit Price formulas
                    </div>
                  </div>

                  <div className="sk-metric" style={{ background: 'color-mix(in srgb, #F59E0B 6%, var(--sk-surface-soft))' }}>
                    <span className="sk-metric__icon" style={{ background: 'color-mix(in srgb, #F59E0B 15%, transparent)', color: '#F59E0B' }}>✍️</span>
                    <span className="sk-metric__label">Manual Override Lines</span>
                    <span className="sk-metric__value" style={{ fontSize: '1.75rem', color: analytics.manualOverrides.manualOverrideCount > 0 ? '#F59E0B' : 'var(--sk-muted)' }}>
                      {analytics.manualOverrides.manualOverrideCount}
                    </span>
                    <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--sk-muted)', marginTop: '4px' }}>
                      Paper-book handwritten totals
                    </div>
                  </div>

                  <div className="sk-metric" style={{ background: 'color-mix(in srgb, #3B82F6 6%, var(--sk-surface-soft))' }}>
                    <span className="sk-metric__icon" style={{ background: 'color-mix(in srgb, #3B82F6 15%, transparent)', color: '#3B82F6' }}>📐</span>
                    <span className="sk-metric__label">Calculated Mathematical Total</span>
                    <span className="sk-metric__value" style={{ fontSize: '1.45rem', color: '#3B82F6' }}>
                      {formatMoney(analytics.manualOverrides.calculatedMathematicalTotalDzd, locale)}
                    </span>
                    <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--sk-muted)', marginTop: '4px' }}>
                      Sum of calculated formulas
                    </div>
                  </div>

                  <div className="sk-metric" style={{ background: 'color-mix(in srgb, var(--sk-primary) 6%, var(--sk-surface-soft))' }}>
                    <span className="sk-metric__icon">💰</span>
                    <span className="sk-metric__label">Final Effective Total</span>
                    <span className="sk-metric__value" style={{ fontSize: '1.45rem', fontWeight: 800 }}>
                      {formatMoney(analytics.manualOverrides.finalEffectiveTotalDzd, locale)}
                    </span>
                    <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: 'var(--sk-muted)', marginTop: '4px' }}>
                      Authoritative reporting sum
                    </div>
                  </div>
                </div>

                {/* Financial Reconciliation & Formula Share */}
                <div style={{ padding: '20px', background: 'var(--sk-surface-soft)', borderRadius: 'var(--sk-radius)', border: '1px solid var(--sk-border)' }}>
                  <h4 style={{ margin: '0 0 16px 0', fontSize: '0.95rem', fontWeight: 800 }}>
                    Formula vs Manual Override Breakdown
                  </h4>

                  {/* Visual Progress Bar */}
                  {(() => {
                    const totalL = analytics.manualOverrides.calculatedLineCount + analytics.manualOverrides.manualOverrideCount;
                    const calcPct = totalL > 0 ? Math.round((analytics.manualOverrides.calculatedLineCount / totalL) * 100) : 100;
                    const overPct = 100 - calcPct;
                    return (
                      <div style={{ marginBottom: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 700, marginBottom: '6px' }}>
                          <span style={{ color: '#10B981' }}>Calculated Lines: {calcPct}%</span>
                          <span style={{ color: overPct > 0 ? '#F59E0B' : 'var(--sk-muted)' }}>Manual Overrides: {overPct}%</span>
                        </div>
                        <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', background: 'var(--sk-border)' }}>
                          <div style={{ width: `${calcPct}%`, background: '#10B981', transition: 'width 0.3s ease' }} />
                          <div style={{ width: `${overPct}%`, background: '#F59E0B', transition: 'width 0.3s ease' }} />
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', paddingTop: '16px', borderTop: '1px solid var(--sk-border)' }}>
                    <div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--sk-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Calculated Subtotal</span>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--sk-text)' }}>
                        {formatMoney(analytics.manualOverrides.calculatedMathematicalTotalDzd, locale)}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--sk-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Override Variance</span>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: analytics.manualOverrides.totalOverrideDifferenceDzd === 0 ? '#10B981' : '#F59E0B' }}>
                        {analytics.manualOverrides.totalOverrideDifferenceDzd > 0 ? '+' : ''}
                        {formatMoney(analytics.manualOverrides.totalOverrideDifferenceDzd, locale)}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--sk-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Effective Final Total</span>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--sk-primary)' }}>
                        {formatMoney(analytics.manualOverrides.finalEffectiveTotalDzd, locale)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* R0-001 GENERIC EXCEL IMPORT CARD */}
      <div className="sk-card">
        <h2>{text.excelTitle}</h2>
        <p>{text.excelHelp}</p>
        <div className="sk-field">
          <label className="sk-field__label" htmlFor="historical-xlsx-file">
            {text.chooseFile}
          </label>
          <input
            id="historical-xlsx-file"
            className="sk-field__input"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={!enabled || busy !== null}
            onChange={(event) => void selectWorkbook(event.target.files?.[0] ?? null)}
          />
        </div>

        {workbook ? (
          <dl className="sk-details-grid" data-testid="workbook-preview">
            <div><dt>{text.transactions}</dt><dd>{workbook.rows.length}</dd></div>
            <div><dt>{text.balances}</dt><dd>{workbook.balances.length}</dd></div>
            <div><dt>{text.errors}</dt><dd>{workbook.errors.length}</dd></div>
          </dl>
        ) : null}

        {workbook?.errors.length ? (
          <div className="sk-banner sk-banner--error" role="alert" data-testid="workbook-errors">
            <strong>{text.errors}</strong>
            <ul>
              {workbook.errors.map((item, index) => (
                <li key={`${item.sheet}-${item.row}-${index}`}>
                  {item.sheet} · {item.row > 0 ? `row ${item.row}` : ''} · {item.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="sk-stack">
          <Button
            type="button"
            loading={busy === 'import'}
            disabled={!canImportGeneric}
            onClick={() => void stageAndValidateExcel()}
          >
            {text.importValidate}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={busy === 'approve'}
            disabled={validation?.status !== 'VALIDATED' || busy !== null}
            onClick={() => void approveGeneric()}
          >
            {text.approve}
          </Button>
        </div>

        {validation ? (
          <ValidationSummary result={validation} locale={locale} text={text} />
        ) : null}
      </div>

      {/* R0-001 MANUAL ENTRY CARD */}
      <div className="sk-card">
        <h2>{text.manualTitle}</h2>
        <p>{text.manualHelp}</p>
        <div className="sk-form-grid">
          <TextField
            label={text.paperId}
            value={manual.paperId}
            disabled={!enabled || busy !== null}
            onChange={(event) => setManual({ ...manual, paperId: event.target.value })}
          />
          <TextField
            label={text.date}
            type="date"
            value={manual.transactionDate}
            disabled={!enabled || busy !== null}
            onChange={(event) => setManual({ ...manual, transactionDate: event.target.value })}
          />
          <label className="sk-field">
            <span className="sk-field__label">{text.type}</span>
            <select
              className="sk-field__input"
              value={manual.transactionType}
              disabled={!enabled || busy !== null}
              onChange={(event) =>
                setManual({
                  ...manual,
                  transactionType: event.target.value as HistoricalTransactionType,
                })
              }
            >
              {TRANSACTION_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <TextField
            label={text.description}
            value={manual.descriptionOrCategory}
            disabled={!enabled || busy !== null}
            onChange={(event) =>
              setManual({ ...manual, descriptionOrCategory: event.target.value })
            }
          />
          <TextField
            label={text.amount}
            inputMode="numeric"
            value={manual.netAmountDzd}
            disabled={!enabled || busy !== null}
            onChange={(event) => setManual({ ...manual, netAmountDzd: event.target.value })}
          />
          <label className="sk-field">
            <span className="sk-field__label">{text.paymentStatus}</span>
            <select
              className="sk-field__input"
              value={manual.paymentStatus}
              disabled={!enabled || busy !== null}
              onChange={(event) =>
                setManual({
                  ...manual,
                  paymentStatus: event.target.value as HistoricalPaymentStatus,
                })
              }
            >
              {PAYMENT_STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <TextField
            label={text.amountPaid}
            inputMode="numeric"
            value={manual.amountPaidDzd}
            disabled={!enabled || busy !== null}
            onChange={(event) => setManual({ ...manual, amountPaidDzd: event.target.value })}
          />
          <TextField
            label={text.expenseCategory}
            value={manual.expenseCategory}
            disabled={!enabled || busy !== null}
            onChange={(event) => setManual({ ...manual, expenseCategory: event.target.value })}
          />
          <TextField
            label={text.supplier}
            value={manual.supplierFournisseur}
            disabled={!enabled || busy !== null}
            onChange={(event) => setManual({ ...manual, supplierFournisseur: event.target.value })}
          />
          <TextField
            label={text.customer}
            value={manual.customerClient}
            disabled={!enabled || busy !== null}
            onChange={(event) => setManual({ ...manual, customerClient: event.target.value })}
          />
          <TextField
            label={text.notes}
            value={manual.notes}
            disabled={!enabled || busy !== null}
            onChange={(event) => setManual({ ...manual, notes: event.target.value })}
          />
        </div>
        <Button
          type="button"
          loading={busy === 'manual'}
          disabled={!enabled || busy !== null}
          onClick={() => void stageManual()}
        >
          {text.saveManual}
        </Button>
      </div>

      {/* R0-001 SUMMARY CARD */}
      <div className="sk-card">
        <h2>{text.summaryTitle}</h2>
        <p>{text.summaryHelp}</p>
        <div className="sk-form-grid">
          <TextField
            label={text.dateFrom}
            type="date"
            value={dateFrom}
            disabled={busy !== null}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <TextField
            label={text.dateTo}
            type="date"
            value={dateTo}
            disabled={busy !== null}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          loading={busy === 'summary'}
          disabled={!dateFrom || !dateTo || busy !== null}
          onClick={() => void loadSummary()}
        >
          {text.loadSummary}
        </Button>

        {summary ? <FinanceSummary result={summary} locale={locale} text={text} /> : null}
      </div>
    </section>
  );
}

function ValidationSummary({
  result,
  locale,
  text,
}: {
  result: HistoricalFinanceValidationResult;
  locale: Locale;
  text: Record<string, string>;
}) {
  return (
    <dl className="sk-details-grid" data-testid="historical-validation-result">
      <div><dt>{text.transactions}</dt><dd>{result.rowCount}</dd></div>
      <div><dt>{text.errors}</dt><dd>{result.invalidRowCount}</dd></div>
      <div><dt>{text.sales}</dt><dd>{formatMoney(result.totalSalesDzd, locale)}</dd></div>
      <div><dt>{text.purchases}</dt><dd>{formatMoney(result.totalPurchasesDzd, locale)}</dd></div>
      <div><dt>{text.expenses}</dt><dd>{formatMoney(result.totalExpensesDzd, locale)}</dd></div>
      <div><dt>{text.preliminary}</dt><dd>{formatMoney(result.preliminaryResultBeforeInventoryDzd, locale)}</dd></div>
    </dl>
  );
}

function MonthlyTrendChart({
  timeline,
  locale,
}: {
  timeline: Array<{
    month: string;
    salesDzd: number;
    purchasesDzd: number;
    saleCount: number;
    purchaseCount: number;
  }>;
  locale: Locale;
}) {
  if (!timeline || timeline.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--sk-muted)', background: 'var(--sk-surface-soft)', borderRadius: 'var(--sk-radius)' }}>
        No monthly timeline records found for this period.
      </div>
    );
  }

  const maxVal = Math.max(
    ...timeline.map((m) => Math.max(m.salesDzd, m.purchasesDzd)),
    1000,
  );

  return (
    <div style={{ padding: '20px', background: 'var(--sk-surface-soft)', borderRadius: 'var(--sk-radius)', border: '1px solid var(--sk-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>Monthly Trade Timeline (Sales vs Purchases)</h4>
        <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', fontWeight: 700 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#10B981' }} /> Sales DZD
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3B82F6' }} /> Purchases DZD
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '180px', paddingTop: '20px', paddingBottom: '24px', borderBottom: '1px solid var(--sk-border)', overflowX: 'auto' }}>
        {timeline.map((item, idx) => {
          const salesPct = Math.max(4, Math.round((item.salesDzd / maxVal) * 100));
          const purchasesPct = Math.max(4, Math.round((item.purchasesDzd / maxVal) * 100));

          return (
            <div key={idx} style={{ flex: 1, minWidth: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '100%', width: '100%', justifyContent: 'center' }}>
                {/* Sales Bar */}
                <div
                  title={`${item.month} Sales: ${formatMoney(item.salesDzd, locale)} (${item.saleCount} txns)`}
                  style={{
                    width: '45%',
                    height: `${salesPct}%`,
                    background: '#10B981',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s ease',
                  }}
                />
                {/* Purchases Bar */}
                <div
                  title={`${item.month} Purchases: ${formatMoney(item.purchasesDzd, locale)} (${item.purchaseCount} txns)`}
                  style={{
                    width: '45%',
                    height: `${purchasesPct}%`,
                    background: '#3B82F6',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s ease',
                  }}
                />
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--sk-muted)', whiteSpace: 'nowrap' }}>
                {item.month}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PaymentProgressBar({
  paid,
  unpaid,
  total,
  locale,
  paidColor,
  unpaidColor,
}: {
  paid: number;
  unpaid: number;
  total: number;
  locale: Locale;
  paidColor: string;
  unpaidColor: string;
}) {
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const unpaidPct = total > 0 ? Math.min(100 - paidPct, Math.round((unpaid / total) * 100)) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px' }}>
        <span>Paid: {formatMoney(paid, locale)} ({paidPct}%)</span>
        <span>Unpaid: {formatMoney(unpaid, locale)} ({unpaidPct}%)</span>
      </div>
      <div style={{ display: 'flex', height: '10px', borderRadius: '6px', overflow: 'hidden', background: 'var(--sk-border)' }}>
        <div style={{ width: `${paidPct}%`, background: paidColor, transition: 'width 0.3s ease' }} />
        <div style={{ width: `${unpaidPct}%`, background: unpaidColor, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function QualityCard({ title, pct }: { title: string; pct: number }) {
  const rounded = Math.round(pct);
  const color = rounded >= 90 ? '#10B981' : rounded >= 60 ? '#F59E0B' : '#EF4444';

  return (
    <div style={{ padding: '16px', background: 'var(--sk-surface-soft)', borderRadius: 'var(--sk-radius)', border: '1px solid var(--sk-border)' }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--sk-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
        {title}
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, color }}>{rounded}%</div>
      <div style={{ height: '6px', borderRadius: '3px', background: 'var(--sk-border)', marginTop: '8px', overflow: 'hidden' }}>
        <div style={{ width: `${rounded}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function FinanceSummary({
  result,
  locale,
  text,
}: {
  result: HistoricalFinanceSummaryResult;
  locale: Locale;
  text: Record<string, string>;
}) {
  return (
    <div data-testid="historical-finance-summary">
      <Banner tone={result.inventoryDataComplete ? 'info' : 'warning'}>
        {result.inventoryDataComplete ? text.inventoryComplete : text.inventoryMissing}
      </Banner>
      <dl className="sk-details-grid">
        <div><dt>{text.sales}</dt><dd>{formatMoney(result.salesDzd, locale)}</dd></div>
        <div><dt>{text.purchases}</dt><dd>{formatMoney(result.purchasesDzd, locale)}</dd></div>
        <div><dt>{text.expenses}</dt><dd>{formatMoney(result.expensesDzd, locale)}</dd></div>
        <div><dt>{text.otherIncome}</dt><dd>{formatMoney(result.otherIncomeDzd, locale)}</dd></div>
        <div><dt>{text.preliminary}</dt><dd>{formatMoney(result.preliminaryResultBeforeInventoryDzd, locale)}</dd></div>
        <div><dt>{text.inventoryAdjusted}</dt><dd>{formatMoney(result.estimatedProfitLossDzd, locale)}</dd></div>
      </dl>
    </div>
  );
}
