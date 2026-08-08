import { useEffect, useMemo, useState } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
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
      if (parsed.errors.length === 0) setFeedback(text.fileReady);
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

  async function loadAnalytics() {
    if (!dateFrom || !dateTo || busy) return;
    setBusy('analytics');
    setError(null);
    setAnalytics(null);
    try {
      const res = await getHistoricalTradeAnalytics(sessionToken, { dateFrom, dateTo });
      setAnalytics(res as unknown as HistoricalTradeAnalyticsResult);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sk-page" aria-labelledby="historical-finance-heading">
      <div className="sk-card">
        <h1 id="historical-finance-heading">{text.title}</h1>
        <p>{text.subtitle}</p>
        <Banner tone="warning">{text.safety}</Banner>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <div className="sk-field" style={{ marginTop: '1rem' }}>
          <label className="sk-field__label" htmlFor="toggle-import-enabled">
            <input
              id="toggle-import-enabled"
              type="checkbox"
              checked={enabled}
              disabled={busy !== null}
              onChange={(event) => void toggleEnabled(event.target.checked)}
            />{' '}
            {text.enabled}
          </label>
          <small className="sk-field-help">{text.enabledHelp}</small>
        </div>
      </div>

      {/* R0-002 PAPER-BOOK 1.5-YEAR XLSX IMPORT CARD */}
      <div className="sk-card">
        <h2>{text.paperBookTitle}</h2>
        <p>{text.paperBookHelp}</p>

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
          <dl className="sk-details-grid" data-testid="paperbook-preview">
            <div><dt>{text.transactions}</dt><dd>{pbData.summary.transactionCount}</dd></div>
            <div><dt>Product Lines</dt><dd>{pbData.summary.lineCount}</dd></div>
            <div><dt>{text.sales}</dt><dd>{formatMoney(pbData.summary.totalSalesDzd, locale)}</dd></div>
            <div><dt>{text.purchases}</dt><dd>{formatMoney(pbData.summary.totalPurchasesDzd, locale)}</dd></div>
            <div><dt>Coverage</dt><dd>{pbData.summary.minDate ?? '—'} → {pbData.summary.maxDate ?? '—'}</dd></div>
          </dl>
        ) : null}

        {pbData?.errors.length ? (
          <div className="sk-banner sk-banner--error" role="alert">
            <strong>{text.errors}</strong>
            <ul>
              {pbData.errors.map((item, index) => (
                <li key={index}>
                  Row {item.row} · {item.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="sk-stack" style={{ marginTop: '1rem' }}>
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
            onClick={() => void approvePaperBook()}
          >
            Approve paper-book batch
          </Button>
        </div>

        {pbValidation ? (
          <dl className="sk-details-grid" style={{ marginTop: '1rem' }} data-testid="paperbook-validation-result">
            <div><dt>Batch Status</dt><dd><strong>{pbValidation.status}</strong></dd></div>
            <div><dt>Transactions</dt><dd>{pbValidation.transactionCount}</dd></div>
            <div><dt>Paid Sales</dt><dd>{formatMoney(pbValidation.paidSalesDzd, locale)}</dd></div>
            <div><dt>Unpaid Sales</dt><dd>{formatMoney(pbValidation.unpaidSalesDzd, locale)}</dd></div>
            <div><dt>Paid Purchases</dt><dd>{formatMoney(pbValidation.paidPurchasesDzd, locale)}</dd></div>
            <div><dt>Unpaid Purchases</dt><dd>{formatMoney(pbValidation.unpaidPurchasesDzd, locale)}</dd></div>
          </dl>
        ) : null}
      </div>

      {/* R0-002 TRADE ANALYTICS DASHBOARD CARD */}
      <div className="sk-card">
        <h2>{text.analyticsTitle}</h2>
        <p>{text.analyticsHelp}</p>

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

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <Button
            type="button"
            variant="secondary"
            loading={busy === 'analytics'}
            disabled={!dateFrom || !dateTo || busy !== null}
            onClick={() => void loadAnalytics()}
          >
            {text.loadAnalytics}
          </Button>
        </div>

        {analytics ? (
          <div style={{ marginTop: '1.5rem' }}>
            <Banner tone="info">
              <strong>⚠️ {text.profitWarning}: </strong>
              {text.profitWarningDetail}
            </Banner>

            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: '0.25rem', margin: '1rem 0', overflowX: 'auto' }}>
              {(['overview', 'sales', 'purchases', 'products', 'brands', 'parties', 'quality', 'overrides'] as AnalyticsSubTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  style={{ textTransform: 'capitalize', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                  className={`sk-button ${analyticsSubTab === tab ? 'sk-button--primary' : 'sk-button--secondary'}`}
                  onClick={() => setAnalyticsSubTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {analyticsSubTab === 'overview' && (
              <dl className="sk-details-grid">
                <div><dt>Transactions</dt><dd>{analytics.overview.transactionCount}</dd></div>
                <div><dt>Product Lines</dt><dd>{analytics.overview.lineCount}</dd></div>
                <div><dt>Total Sales</dt><dd>{formatMoney(analytics.overview.totalSalesDzd, locale)}</dd></div>
                <div><dt>Total Purchases</dt><dd>{formatMoney(analytics.overview.totalPurchasesDzd, locale)}</dd></div>
                <div><dt>Paid Sales</dt><dd>{formatMoney(analytics.overview.paidSalesDzd, locale)}</dd></div>
                <div><dt>Unpaid Sales</dt><dd>{formatMoney(analytics.overview.unpaidSalesDzd, locale)}</dd></div>
                <div><dt>{text.tradeDifference}</dt><dd><strong>{formatMoney(analytics.overview.tradeDifferenceDzd, locale)}</strong></dd></div>
              </dl>
            )}

            {analyticsSubTab === 'sales' && (
              <div>
                <dl className="sk-details-grid">
                  <div><dt>Total Sales</dt><dd>{formatMoney(analytics.payment.sales.total, locale)}</dd></div>
                  <div><dt>Paid Sales</dt><dd>{formatMoney(analytics.payment.sales.paid, locale)}</dd></div>
                  <div><dt>Unpaid Sales</dt><dd>{formatMoney(analytics.payment.sales.unpaid, locale)}</dd></div>
                </dl>
              </div>
            )}

            {analyticsSubTab === 'purchases' && (
              <div>
                <dl className="sk-details-grid">
                  <div><dt>Total Purchases</dt><dd>{formatMoney(analytics.payment.purchases.total, locale)}</dd></div>
                  <div><dt>Paid Purchases</dt><dd>{formatMoney(analytics.payment.purchases.paid, locale)}</dd></div>
                  <div><dt>Unpaid Purchases</dt><dd>{formatMoney(analytics.payment.purchases.unpaid, locale)}</dd></div>
                </dl>
              </div>
            )}

            {analyticsSubTab === 'products' && (
              <table style={{ width: '100%', marginTop: '0.5rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sk-color-border)', textAlign: 'left' }}>
                    <th>Product Name</th><th>Matched</th><th>Qty Sold</th><th>Sales DZD</th><th>Qty Purchased</th><th>Purchases DZD</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.products.map((p, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--sk-color-border)' }}>
                      <td>{p.productName}</td>
                      <td>{p.matchedProductId ? 'Yes' : 'No'}</td>
                      <td>{p.qtySold}</td>
                      <td>{formatMoney(p.salesDzd, locale)}</td>
                      <td>{p.qtyPurchased}</td>
                      <td>{formatMoney(p.purchasesDzd, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {analyticsSubTab === 'brands' && (
              <table style={{ width: '100%', marginTop: '0.5rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sk-color-border)', textAlign: 'left' }}>
                    <th>Brand</th><th>Sales DZD</th><th>Purchases DZD</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.brands.map((b, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--sk-color-border)' }}>
                      <td>{b.brand}</td>
                      <td>{formatMoney(b.salesDzd, locale)}</td>
                      <td>{formatMoney(b.purchasesDzd, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {analyticsSubTab === 'parties' && (
              <table style={{ width: '100%', marginTop: '0.5rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sk-color-border)', textAlign: 'left' }}>
                    <th>Party / Company</th><th>Sales DZD</th><th>Purchases DZD</th><th>Total Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.parties.map((pty, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--sk-color-border)' }}>
                      <td>{pty.partyCompany}</td>
                      <td>{formatMoney(pty.salesDzd, locale)}</td>
                      <td>{formatMoney(pty.purchasesDzd, locale)}</td>
                      <td>{formatMoney(pty.totalVolumeDzd, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {analyticsSubTab === 'quality' && (
              <dl className="sk-details-grid">
                <div><dt>Total Lines</dt><dd>{analytics.dataQuality.totalLines}</dd></div>
                <div><dt>Product Name Coverage</dt><dd>{analytics.dataQuality.productNameCoveragePct.toFixed(1)}%</dd></div>
                <div><dt>Brand Coverage</dt><dd>{analytics.dataQuality.brandCoveragePct.toFixed(1)}%</dd></div>
                <div><dt>Party Coverage</dt><dd>{analytics.dataQuality.partyCoveragePct.toFixed(1)}%</dd></div>
                <div><dt>Page No Coverage</dt><dd>{analytics.dataQuality.pageNumberCoveragePct.toFixed(1)}%</dd></div>
                <div><dt>Quantity Coverage</dt><dd>{analytics.dataQuality.quantityCoveragePct.toFixed(1)}%</dd></div>
                <div><dt>Unmatched Products</dt><dd>{analytics.dataQuality.unmatchedProductCount}</dd></div>
                <div><dt>Manual Total Overrides</dt><dd>{analytics.dataQuality.manualOverrideCount}</dd></div>
              </dl>
            )}

            {analyticsSubTab === 'overrides' && (
              <dl className="sk-details-grid">
                <div><dt>Calculated Formula Lines</dt><dd>{analytics.manualOverrides.calculatedLineCount}</dd></div>
                <div><dt>Manual Override Lines</dt><dd>{analytics.manualOverrides.manualOverrideCount}</dd></div>
                <div><dt>Calculated Mathematical Total</dt><dd>{formatMoney(analytics.manualOverrides.calculatedMathematicalTotalDzd, locale)}</dd></div>
                <div><dt>Final Effective Total</dt><dd>{formatMoney(analytics.manualOverrides.finalEffectiveTotalDzd, locale)}</dd></div>
                <div><dt>Total Override Difference</dt><dd><strong>{formatMoney(analytics.manualOverrides.totalOverrideDifferenceDzd, locale)}</strong></dd></div>
              </dl>
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
