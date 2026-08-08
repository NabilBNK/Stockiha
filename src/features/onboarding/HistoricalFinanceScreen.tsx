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
import { HistoricalAnalyticsDashboard } from './HistoricalAnalyticsDashboard';
import { HistoricalImportPanel } from './HistoricalImportPanel';
import { HistoricalImportStepper, type ImportStep } from './HistoricalImportStepper';
import { HistoricalIssueList } from './HistoricalIssueList';
import { HistoricalKpiCard } from './HistoricalKpiCard';
import { HistoricalRowPreview } from './HistoricalRowPreview';
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
    subtitle: 'Import the 1.5-year finance history from the official Excel paper book or enter missing records manually.',
    safety: 'Historical data is staged for review and reporting only. It does not create live sales, purchases, stock, cash, receivables, payables, or journal entries.',
    enabled: 'Historical finance import enabled',
    enabledHelp: 'CEO/administrator control. It is ON by default and blocks new batches when disabled.',
    paperBookTitle: 'Primary Path — Paper-Book 1.5-Year XLSX Import (BUY / SELL / EXPENSE)',
    paperBookHelp: 'Use the official Stockiha paper-book template with Transactions sheet. Continuation rows, line-level party, and line-level manual benefit are supported.',
    excelTitle: 'Secondary Path — Generic Excel Import (R0-001)',
    excelHelp: 'Use the generic Stockiha workbook with Historical_Transactions and Balances sheets.',
    chooseFile: 'Choose .xlsx workbook',
    fileReady: 'Workbook parsed successfully.',
    transactions: 'Transaction rows',
    balances: 'Balance rows',
    errors: 'Workbook errors',
    importValidatePaperBook: 'Stage and validate paper book',
    importValidate: 'Stage and validate workbook',
    validated: 'The batch is clean and ready for approval.',
    needsReview: 'The batch contains validation issues and cannot be approved yet.',
    approvePaperBook: 'Approve paper book for reporting',
    approve: 'Approve for historical reporting',
    approved: 'Historical batch approved for reporting.',
    manualTitle: 'Secondary Path — Manual Entry',
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
    summaryTitle: 'Historical Finance Summary',
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
    loadAnalytics: 'Compute Trade Analytics',
  },
  fr: {
    title: 'Intégration financière historique',
    subtitle: 'Importer 1,5 an d’historique financier depuis le registre papier Excel officiel ou saisir manuellement un document manquant.',
    safety: 'Les données historiques sont préparées uniquement pour contrôle et reporting. Elles ne créent aucune vente, achat, stock, caisse, créance, dette ou écriture comptable active.',
    enabled: 'Import financier historique activé',
    enabledHelp: 'Contrôle du PDG/administrateur. Activé par défaut et bloque les nouveaux lots lorsqu’il est désactivé.',
    paperBookTitle: 'Chemin Principal — Import Registre Papier 1,5 An (ACHAT / VENTE / DÉPENSE)',
    paperBookHelp: 'Utilisez le modèle officiel avec la feuille Transactions.',
    excelTitle: 'Chemin Secondaire — Import Excel Générique (R0-001)',
    excelHelp: 'Utilisez le classeur générique avec les feuilles Historical_Transactions et Balances.',
    chooseFile: 'Choisir le classeur .xlsx',
    fileReady: 'Classeur analysé avec succès.',
    transactions: 'Lignes de transactions',
    balances: 'Lignes de soldes',
    errors: 'Erreurs du classeur',
    importValidatePaperBook: 'Préparer et valider le registre',
    importValidate: 'Préparer et valider le classeur',
    validated: 'Le lot est valide et prêt pour approbation.',
    needsReview: 'Le lot contient des erreurs et ne peut pas être approuvé.',
    approve: 'Approuver pour le reporting historique',
    approved: 'Lot historique approuvé pour le reporting.',
    manualTitle: 'Chemin Secondaire — Saisie Manuelle',
    manualHelp: 'À utiliser pour un document manquant ou un lot de correction.',
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
    summaryTitle: 'Résumé Financier Historique',
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
    inventoryMissing: 'Les valeurs de stock initial et final manquent.',
    inventoryComplete: 'Les valeurs de stock initial et final ont été appliquées.',
    invalidManual: 'Complétez les champs obligatoires avec un montant entier DZD positif.',
    parseFailed: 'Le classeur ne peut pas être lu.',
    analyticsTitle: 'Tableau de Bord Analytique Historique',
    analyticsHelp: 'Analytique multidimensionnelle pour les enregistrements du registre papier approuvés.',
    loadAnalytics: 'Calculer l’analytique',
  },
  ar: {
    title: 'إدخال البيانات المالية التاريخية',
    subtitle: 'استيراد السجل المالي لمدة سنة ونصف من ملف Excel الرسمي أو إدخال ورقة ناقصة يدوياً.',
    safety: 'تُحفظ البيانات التاريخية للمراجعة والتقارير فقط. لا تنشئ مبيعات أو مشتريات أو مخزوناً أو حركة صندوق أو ديوناً أو قيوداً محاسبية مباشرة.',
    enabled: 'تفعيل استيراد البيانات المالية التاريخية',
    enabledHelp: 'إعداد المدير/المسؤول. مفعّل افتراضياً ويمنع إنشاء دفعات جديدة عند تعطيله.',
    paperBookTitle: 'المسار الرئيسي — استيراد سجل الورق (شراء / بيع / مصاريف)',
    paperBookHelp: 'استعمل ملف سجل الورق الرسمي مع ورقة Transactions.',
    excelTitle: 'المسار الثانوي — استيراد Excel العام (R0-001)',
    excelHelp: 'استعمل ملف Stockiha العام الذي يحتوي على Historical_Transactions وBalances.',
    chooseFile: 'اختيار ملف .xlsx',
    fileReady: 'تمت قراءة الملف بنجاح.',
    transactions: 'أسطر المعاملات',
    balances: 'أسطر الأرصدة',
    errors: 'أخطاء الملف',
    importValidatePaperBook: 'حفظ السجل الورقي مؤقتاً والتحقق منه',
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
    inventoryMissing: 'قيمة مخزون البداية والنهاية غير متوفرة.',
    inventoryComplete: 'تم احتساب مخزون البداية والنهاية.',
    invalidManual: 'أكمل الحقول الإجبارية بمبلغ صحيح وموجب بالدينار.',
    parseFailed: 'تعذر قراءة الملف.',
    analyticsTitle: 'لوحة تحليلات المعاملات التاريخية',
    analyticsHelp: 'تحليل المعاملات التاريخية المعتمدة خلال الفترة المحددة.',
    loadAnalytics: 'حساب التحليلات التاريخية',
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

  // Paper Book R0-002 State
  const [pbFile, setPbFile] = useState<File | null>(null);
  const [pbData, setPbData] = useState<PaperBookWorkbookData | null>(null);
  const [pbValidation, setPbValidation] = useState<HistoricalTradeValidationResult | null>(null);
  const [pbActiveBatchId, setPbActiveBatchId] = useState<number | null>(null);
  const [showConfirmApprovePaperBook, setShowConfirmApprovePaperBook] = useState(false);
  const [showConfirmApproveGeneric, setShowConfirmApproveGeneric] = useState(false);

  // Analytics & Summary State
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [analyticsDateFrom, setAnalyticsDateFrom] = useState('2024-01-01');
  const [analyticsDateTo, setAnalyticsDateTo] = useState('2026-12-31');
  const [summary, setSummary] = useState<HistoricalFinanceSummaryResult | null>(null);
  const [analytics, setAnalytics] = useState<HistoricalTradeAnalyticsResult | null>(null);

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

  // Workflow step determination
  const currentStep: ImportStep = useMemo(() => {
    if (pbValidation?.status === 'APPROVED_FOR_REPORTING') return 'approved';
    if (pbValidation?.status === 'VALIDATED') return 'validated';
    if (pbData !== null) return 'parsed';
    return 'select';
  }, [pbValidation, pbData]);

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
        contentHash: pbData.summary.contentHash ?? pbData.contentHash,
        importProfile: 'PAPER_BOOK_V2',
      });
      setPbActiveBatchId(batch.batchId);

      const replaced = await replaceHistoricalTradeBatchData(sessionToken, {
        batchId: batch.batchId,
        transactions: pbData.transactions.map((txn) => ({
          sourceTransactionSequence: txn.sourceTransactionSequence,
          sourceFirstExcelRow: txn.sourceFirstExcelRow,
          sourceExcelTxnRef: txn.sourceExcelTxnRef,
          transactionDate: txn.transactionDate,
          transactionType: txn.transactionType,
          paymentStatus: txn.paymentStatus,
          partyCompany: txn.partyCompany,
          manualBenefitDzd: txn.manualBenefitDzd,
          pageNumber: txn.pageNumber,
          lines: txn.lines.map((line) => ({
            sourceRowNumber: line.sourceRowNumber,
            lineSequence: line.lineSequence,
            productName: line.productName,
            brand: line.brand,
            customDetails: line.customDetails,
            partyCompany: line.partyCompany,
            manualBenefitDzd: line.manualBenefitDzd,
            quantity: line.quantity,
            unitPriceDzd: line.unitPriceDzd,
            manualLineTotalDzd: line.manualLineTotalDzd,
          })),
        })),
      });

      const validated = await validateHistoricalTradeBatch(sessionToken, {
        batchId: replaced.batchId,
      });
      setPbValidation(validated);

      if (validated.status === 'VALIDATED') {
        setFeedback(text.validated);
      } else {
        setError(text.needsReview);
      }
    } catch (importError) {
      setError(errorText(importError));
    } finally {
      setBusy(null);
    }
  }

  async function approvePaperBook() {
    if (!pbActiveBatchId) return;
    setBusy('approve');
    setError(null);
    setFeedback(null);
    try {
      const approved = await approveHistoricalTradeBatch(sessionToken, {
        batchId: pbActiveBatchId,
      });
      setPbValidation({
        batchId: approved.batchId,
        status: approved.status as 'APPROVED_FOR_REPORTING',
        transactionCount: pbValidation?.transactionCount ?? pbValidation?.rowCount ?? 0,
        rowCount: pbValidation?.rowCount ?? pbValidation?.transactionCount ?? 0,
        lineCount: pbValidation?.lineCount ?? pbValidation?.totalLines ?? 0,
        totalLines: pbValidation?.totalLines ?? pbValidation?.lineCount ?? 0,
        invalidRowCount: 0,
        unmatchedProductCount: pbValidation?.unmatchedProductCount ?? 0,
        overrideCount: pbValidation?.overrideCount ?? 0,
        missingQtyCount: pbValidation?.missingQtyCount ?? 0,
        totalSalesDzd: pbValidation?.totalSalesDzd ?? 0,
        totalPurchasesDzd: pbValidation?.totalPurchasesDzd ?? 0,
        totalExpensesDzd: pbValidation?.totalExpensesDzd ?? 0,
        paidSalesDzd: pbValidation?.paidSalesDzd ?? 0,
        unpaidSalesDzd: pbValidation?.unpaidSalesDzd ?? 0,
        paidPurchasesDzd: pbValidation?.paidPurchasesDzd ?? 0,
        unpaidPurchasesDzd: pbValidation?.unpaidPurchasesDzd ?? 0,
        paidExpensesDzd: pbValidation?.paidExpensesDzd ?? 0,
        unpaidExpensesDzd: pbValidation?.unpaidExpensesDzd ?? 0,
        manualBenefitCount: pbValidation?.manualBenefitCount ?? 0,
        totalManualBenefitDzd: pbValidation?.totalManualBenefitDzd ?? 0,
      });
      setFeedback(text.approved);

      // Auto-refresh analytics after approval
      void loadAnalytics();
    } catch (approveError) {
      setError(errorText(approveError));
    } finally {
      setBusy(null);
    }
  }

  async function loadAnalytics() {
    if (!analyticsDateFrom || !analyticsDateTo) return;
    setBusy('analytics');
    setError(null);
    try {
      const res = await getHistoricalTradeAnalytics(sessionToken, {
        dateFrom: analyticsDateFrom,
        dateTo: analyticsDateTo,
      });
      setAnalytics(res);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function selectWorkbook(file: File | null) {
    setSelectedFile(file);
    setWorkbook(null);
    setValidation(null);
    setError(null);
    setFeedback(null);
    if (!file) return;

    setBusy('parse');
    try {
      const parsed = await parseHistoricalFinanceWorkbook(file);
      setWorkbook(parsed);
      if (parsed.errors.length === 0) setFeedback(text.fileReady);
    } catch (parseError) {
      setError(`${text.parseFailed} ${parseError instanceof Error ? parseError.message : ''}`.trim());
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

      const replaced = await replaceHistoricalFinanceBatchData(sessionToken, {
        batchId: batch.batchId,
        rows: workbook.rows,
        balances: workbook.balances,
      });

      const validated = await validateHistoricalFinanceBatch(sessionToken, {
        batchId: replaced.batchId,
      });
      setValidation(validated);

      if (validated.status === 'VALIDATED') setFeedback(text.validated);
      else setError(text.needsReview);
    } catch (importError) {
      setError(errorText(importError));
    } finally {
      setBusy(null);
    }
  }

  async function approveGeneric() {
    if (!validation?.batchId) return;
    setBusy('approve');
    setError(null);
    setFeedback(null);
    try {
      const approved = await approveHistoricalFinanceBatch(sessionToken, {
        batchId: validation.batchId,
      });
      setValidation({ ...validation, status: approved.status as 'VALIDATED' });
      setFeedback(text.approved);
    } catch (approveError) {
      setError(errorText(approveError));
    } finally {
      setBusy(null);
    }
  }

  async function stageManual() {
    if (!enabled || busy) return;
    const amountDzd = parseWholeAmount(manual.netAmountDzd);
    const amountPaidDzd = parseWholeAmount(manual.amountPaidDzd, true);
    if (!manual.paperId.trim() || !manual.transactionDate || amountDzd === null || amountDzd <= 0) {
      setError(text.invalidManual);
      return;
    }

    setBusy('manual');
    setError(null);
    setFeedback(null);
    try {
      const batch = await createHistoricalFinanceBatch(sessionToken, {
        requestId: nextRequestId('manual'),
        sourceType: 'MANUAL',
        originalFilename: null,
      });

      const replaced = await replaceHistoricalFinanceBatchData(sessionToken, {
        batchId: batch.batchId,
        rows: [
          {
            sourceRowNumber: 2,
            paperId: manual.paperId.trim(),
            transactionDate: manual.transactionDate,
            transactionType: manual.transactionType,
            descriptionOrCategory: manual.descriptionOrCategory.trim(),
            netAmountDzd: amountDzd,
            paymentStatus: manual.paymentStatus,
            amountPaidDzd: amountPaidDzd ?? amountDzd,
            expenseCategory: optional(manual.expenseCategory),
            supplierFournisseur: optional(manual.supplierFournisseur),
            customerClient: optional(manual.customerClient),
            notes: optional(manual.notes),
            reviewStatus: 'READY',
          },
        ],
        balances: [],
      });

      const validated = await validateHistoricalFinanceBatch(sessionToken, {
        batchId: replaced.batchId,
      });
      setValidation(validated);
      setManual(EMPTY_MANUAL);

      if (validated.status === 'VALIDATED') setFeedback(text.manualSaved);
      else setError(text.needsReview);
    } catch (manualError) {
      setError(errorText(manualError));
    } finally {
      setBusy(null);
    }
  }

  async function loadSummary() {
    if (!dateFrom || !dateTo) return;
    setBusy('summary');
    setError(null);
    try {
      const res = await getHistoricalFinanceSummary(sessionToken, { dateFrom, dateTo });
      setSummary(res);
    } catch (summaryError) {
      setError(errorText(summaryError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sk-space-y">
      <header className="sk-page-header">
        <div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <label className="sk-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy !== null}
            onChange={(e) => void toggleEnabled(e.target.checked)}
          />
          <span>{text.enabled}</span>
        </label>
      </header>

      <Banner tone="info">{text.safety}</Banner>
      {feedback && <Banner tone="success">{feedback}</Banner>}
      {error && <Banner tone="warning">{error}</Banner>}

      {/* R0-002 PRIMARY PAPER BOOK IMPORT CARD */}
      <div className="sk-card">
        <h2>{text.paperBookTitle}</h2>
        <p>{text.paperBookHelp}</p>

        {/* Workflow Stepper Progress Indicator */}
        <HistoricalImportStepper
          currentStep={currentStep}
          hasErrors={pbData?.errors.length ? pbData.errors.length > 0 : false}
          locale={locale}
        />

        {/* Drag & Drop File Select Panel */}
        <HistoricalImportPanel
          file={pbFile}
          enabled={enabled}
          busy={busy !== null}
          locale={locale}
          onFileSelect={(f) => void selectPaperBookFile(f)}
        />

        {/* Parsed Summary KPI Cards */}
        {pbData && (
          <div className="mt-4">
            <div className="sk-kpi-grid">
              <HistoricalKpiCard
                title={locale === 'ar' ? 'المبيعات المحسوبة' : 'Parsed Sales'}
                value={pbData.summary.totalSalesDzd}
                locale={locale}
                tone="success"
                badgeText={pbData.summary.paidSalesDzd > 0 ? 'Paid: ' + formatMoney(pbData.summary.paidSalesDzd, locale) : undefined}
              />
              <HistoricalKpiCard
                title={locale === 'ar' ? 'المشتريات المحسوبة' : 'Parsed Purchases'}
                value={pbData.summary.totalPurchasesDzd}
                locale={locale}
                tone="info"
              />
              <HistoricalKpiCard
                title={locale === 'ar' ? 'المصاريف المحسوبة' : 'Parsed Expenses'}
                value={pbData.summary.totalExpensesDzd}
                locale={locale}
                tone="warning"
              />
              <HistoricalKpiCard
                title={locale === 'ar' ? 'الفائدة المسجلة' : 'Recorded Benefit (Sell Only)'}
                value={pbData.summary.totalManualBenefitDzd}
                locale={locale}
                tone="primary"
              />
            </div>
          </div>
        )}

        {/* Errors and Warnings List */}
        {pbData?.errors && pbData.errors.length > 0 && (
          <HistoricalIssueList
            errors={pbData.errors}
            locale={locale}
            isPartial={pbData.summary.isPartial}
          />
        )}

        {/* Interactive Row Preview Table */}
        {pbData && pbData.transactions.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold mb-2">
              {locale === 'ar' ? 'معاينة المعاملات والأسطر' : 'Transaction & Line Row Preview'} ({pbData.transactions.length} Txns, {pbData.summary.totalLines} Lines)
            </h3>
            <HistoricalRowPreview
              transactions={pbData.transactions}
              locale={locale}
              isPartial={pbData.summary.isPartial}
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="sk-stack mt-4">
          <Button
            type="button"
            loading={busy === 'import'}
            disabled={!canImportPaperBook}
            onClick={() => void stageAndValidatePaperBook()}
          >
            {text.importValidatePaperBook}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={busy === 'approve'}
            disabled={pbValidation?.status !== 'VALIDATED' || busy !== null}
            onClick={() => setShowConfirmApprovePaperBook(true)}
          >
            {text.approvePaperBook}
          </Button>
        </div>

        {showConfirmApprovePaperBook ? (
          <ConfirmDialog
            title={locale === 'ar' ? 'تأكيد الموافقة على دفتر الورق' : 'Confirm Paper-Book Approval'}
            body={
              locale === 'ar'
                ? 'هل أنت تأكد من الموافقة على هذا السجل الورقي؟ بعد الموافقة، سيتم اعتماد البيانات للتقارير التاريخية ولن يمكن تعديلها.'
                : 'Are you sure you want to approve this 1.5-year paper book import? Once approved, transactions will be finalized for reporting and cannot be modified.'
            }
            confirmLabel={locale === 'ar' ? 'موافقة' : 'Approve'}
            cancelLabel={locale === 'ar' ? 'إلغاء' : 'Cancel'}
            confirmVariant="primary"
            busy={busy === 'approve'}
            onConfirm={() => {
              setShowConfirmApprovePaperBook(false);
              void approvePaperBook();
            }}
            onCancel={() => setShowConfirmApprovePaperBook(false)}
          />
        ) : null}
      </div>

      {/* ANALYTICS DASHBOARD CARD */}
      <div className="sk-card">
        <h2>{text.analyticsTitle}</h2>
        <p>{text.analyticsHelp}</p>

        <div className="sk-form-grid">
          <TextField
            label={text.analyticsDateFrom}
            type="date"
            value={analyticsDateFrom}
            disabled={busy !== null}
            onChange={(e) => setAnalyticsDateFrom(e.target.value)}
          />
          <TextField
            label={text.analyticsDateTo}
            type="date"
            value={analyticsDateTo}
            disabled={busy !== null}
            onChange={(e) => setAnalyticsDateTo(e.target.value)}
          />
        </div>

        <Button
          type="button"
          loading={busy === 'analytics'}
          disabled={!analyticsDateFrom || !analyticsDateTo || busy !== null}
          onClick={() => void loadAnalytics()}
        >
          {text.loadAnalytics}
        </Button>

        {analytics && <HistoricalAnalyticsDashboard analytics={analytics} locale={locale} />}
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
            onClick={() => setShowConfirmApproveGeneric(true)}
          >
            {text.approve}
          </Button>
        </div>

        {showConfirmApproveGeneric ? (
          <ConfirmDialog
            title={locale === 'ar' ? 'تأكيد الموافقة على الدفعة' : 'Confirm Batch Approval'}
            body={
              locale === 'ar'
                ? 'هل أنت تأكد من الموافقة على هذه الدفعة المالية التاريخية؟ بعد الموافقة، سيتم اعتماد البيانات للتقارير التاريخية ولن يمكن تعديلها.'
                : 'Are you sure you want to approve this historical finance batch? Once approved, the staged transactions will be finalized for reporting and cannot be modified.'
            }
            confirmLabel={locale === 'ar' ? 'موافقة' : 'Approve'}
            cancelLabel={locale === 'ar' ? 'إلغاء' : 'Cancel'}
            confirmVariant="primary"
            busy={busy === 'approve'}
            onConfirm={() => {
              setShowConfirmApproveGeneric(false);
              void approveGeneric();
            }}
            onCancel={() => setShowConfirmApproveGeneric(false)}
          />
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
