/**
 * WS-M-3 (§M3-04): the end-of-day cash session report A4 layout. No
 * amount-in-words -- this is an internal reconciliation report, not a
 * customer-facing money claim.
 */
import type { OfficialDocumentModel, PrintLocale } from '../officialDocument';
import type { SessionReport } from '../../ipc/cashSessionDto';
import { getModelLabels } from './shared';

const TITLES: Record<PrintLocale, string> = {
  fr: 'Rapport de caisse',
  ar: 'تقرير الصندوق',
  en: 'Cash Session Report',
};

const TOTAL_LABELS: Record<string, Record<PrintLocale, string>> = {
  openingFloat: { fr: 'Fond de caisse', ar: 'رصيد الصندوق الافتتاحي', en: 'Opening float' },
  cashSales: { fr: 'Ventes au comptant', ar: 'المبيعات النقدية', en: 'Cash sales' },
  creditSales: { fr: 'Ventes à crédit', ar: 'المبيعات بالآجل', en: 'Credit sales' },
  cancellations: { fr: 'Annulations', ar: 'الإلغاءات', en: 'Cancellations' },
  customerPayments: { fr: 'Encaissements clients', ar: 'مقبوضات الزبائن', en: 'Customer payments' },
  refunds: { fr: 'Remboursements', ar: 'المستردات', en: 'Refunds' },
  cashIn: { fr: 'Entrées de caisse', ar: 'إدخالات الصندوق', en: 'Cash in' },
  cashOut: { fr: 'Sorties de caisse', ar: 'إخراجات الصندوق', en: 'Cash out' },
  expected: { fr: 'Théorique', ar: 'المبلغ النظري', en: 'Expected' },
  counted: { fr: 'Compté', ar: 'المبلغ المعدود', en: 'Counted' },
  variance: { fr: 'Écart', ar: 'الفرق', en: 'Variance' },
};

const META_LABELS: Record<string, Record<PrintLocale, string>> = {
  opened: { fr: 'Ouverture', ar: 'فتح', en: 'Opened' },
  closed: { fr: 'Clôture', ar: 'إغلاق', en: 'Closed' },
};

const REASON_LABELS: Record<string, Record<PrintLocale, string>> = {
  SUPPLIER_PAYMENT: { fr: 'Paiement fournisseur', ar: 'دفع للمورد', en: 'Supplier payment' },
  EXPENSE: { fr: 'Dépense', ar: 'مصروف', en: 'Expense' },
  CHANGE_FLOAT: { fr: 'Appoint de caisse', ar: 'تغيير فكة الصندوق', en: 'Change float' },
  CORRECTION: { fr: 'Correction', ar: 'تصحيح', en: 'Correction' },
  OTHER: { fr: 'Autre', ar: 'أخرى', en: 'Other' },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildSessionReportModel(
  report: SessionReport,
  documentDateText: string,
  printLocale: PrintLocale,
): OfficialDocumentModel {
  const labels = getModelLabels(printLocale);

  const metaRows = [
    { label: labels.number, value: `#${report.session.id}` },
    { label: labels.workstation, value: report.session.workstation_id },
    { label: META_LABELS.opened[printLocale], value: formatDateTime(report.session.opened_at) },
    { label: META_LABELS.closed[printLocale], value: formatDateTime(report.session.closed_at) },
  ];
  if (report.session.opened_by) {
    metaRows.push({ label: labels.cashier, value: report.session.opened_by });
  }

  const rows = report.movements.rows.map((movement) => ({
    time: formatDateTime(movement.recorded_at),
    type: movement.type === 'CASH_IN' ? TOTAL_LABELS.cashIn[printLocale] : TOTAL_LABELS.cashOut[printLocale],
    reason: movement.reason_code ? REASON_LABELS[movement.reason_code]?.[printLocale] ?? movement.reason_code : (movement.note ?? '—'),
    amount: movement.amount,
  }));

  return {
    kind: 'CASH_SESSION_REPORT',
    title: TITLES[printLocale],
    documentNumber: `SESSION-${report.session.id}`,
    documentDateText,
    statusText: report.session.status,
    metaBlock: { title: labels.date, rows: metaRows },
    columns: [
      { key: 'time', label: labels.date, align: 'start' },
      { key: 'type', label: labels.type, align: 'start' },
      { key: 'reason', label: labels.reason, align: 'start' },
      { key: 'amount', label: labels.amount, align: 'end' },
    ],
    rows,
    totals: [
      { label: TOTAL_LABELS.openingFloat[printLocale], value: report.session.opening_float },
      { label: `${TOTAL_LABELS.cashSales[printLocale]} (${report.sales.cash_count})`, value: report.sales.cash_total },
      { label: `${TOTAL_LABELS.creditSales[printLocale]} (${report.sales.credit_count})`, value: report.sales.credit_total },
      { label: `${TOTAL_LABELS.cancellations[printLocale]} (${report.sales.void_count})`, value: report.sales.void_total },
      { label: TOTAL_LABELS.customerPayments[printLocale], value: report.customer.payments_total },
      { label: TOTAL_LABELS.refunds[printLocale], value: report.customer.refunds_total },
      { label: TOTAL_LABELS.cashIn[printLocale], value: report.movements.cash_in_total },
      { label: TOTAL_LABELS.cashOut[printLocale], value: report.movements.cash_out_total },
      { label: TOTAL_LABELS.expected[printLocale], value: report.cash.expected },
      { label: TOTAL_LABELS.counted[printLocale], value: report.cash.counted ?? '—' },
      { label: TOTAL_LABELS.variance[printLocale], value: report.cash.variance ?? '—', emphasis: true },
    ],
  };
}
