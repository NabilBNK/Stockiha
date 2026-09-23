/**
 * WS-M-3 — the end-of-day cash session report, thermal roll printer output.
 * Mirrors the layout conventions of `receiptBuilder.ts`/`voidSlipBuilder.ts`.
 *
 * Money arrives here as decimal strings from `cash.get_session_report` and
 * is never converted to a number for display.
 */
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
import type { SessionReport } from '../../shared/ipc/cashSessionDto';
import { toPrinterBytes } from '../pos/receiptBuilder';

const ESC = 0x1b;
const GS = 0x1d;
const CURRENCY = 'DZD';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Builds the ESC/POS byte payload for the end-of-day cash session report. */
export function buildThermalSessionReport(
  report: SessionReport,
  settings: PrintingSettingsDto,
  locale?: string,
): number[] {
  const width = settings.thermal_columns;
  const isEn = locale === 'en';
  const bytes: number[] = [];

  const line = (text: string) => {
    bytes.push(...toPrinterBytes(text), 0x0a);
  };

  const row = (label: string, value: string) => {
    const gap = Math.max(1, width - label.length - value.length);
    line(label + ' '.repeat(gap) + value);
  };

  bytes.push(ESC, 0x40); // Initialise printer

  // 1. Shop identity, centred.
  bytes.push(ESC, 0x61, 0x01);
  if (settings.shop_name) {
    bytes.push(ESC, 0x45, 0x01);
    line(settings.shop_name);
    bytes.push(ESC, 0x45, 0x00);
  }
  if (settings.shop_address) line(settings.shop_address);
  if (settings.shop_phone) {
    const phone = settings.shop_phone.toLowerCase().startsWith('tel')
      ? settings.shop_phone
      : `Tel: ${settings.shop_phone}`;
    line(phone);
  }

  bytes.push(ESC, 0x61, 0x00);
  line('='.repeat(width));

  // 2. Title, centred and bold.
  bytes.push(ESC, 0x61, 0x01);
  bytes.push(ESC, 0x45, 0x01);
  line(isEn ? 'END-OF-DAY CASH REPORT' : 'RAPPORT DE CAISSE');
  bytes.push(ESC, 0x45, 0x00);
  bytes.push(ESC, 0x61, 0x00);
  line('='.repeat(width));

  // 3. Session metadata.
  line(`${isEn ? 'Session' : 'Session'} : #${report.session.id}`);
  line(`${isEn ? 'Workstation' : 'Poste'} : ${report.session.workstation_id}`);
  line(`${isEn ? 'Opened' : 'Ouverte'} : ${formatDateTime(report.session.opened_at)}`);
  line(`${isEn ? 'Closed' : 'Cloturee'} : ${formatDateTime(report.session.closed_at)}`);
  if (report.session.opened_by) {
    line(`${isEn ? 'Cashier' : 'Caissier'} : ${report.session.opened_by}`);
  }

  line('-'.repeat(width));

  // 4. Figures.
  row(isEn ? 'Opening float' : 'Fond de caisse', `${report.session.opening_float} ${CURRENCY}`);
  row(
    isEn ? `Cash sales (${report.sales.cash_count})` : `Ventes comptant (${report.sales.cash_count})`,
    `${report.sales.cash_total} ${CURRENCY}`,
  );
  row(
    isEn ? `Credit sales (${report.sales.credit_count})` : `Ventes a credit (${report.sales.credit_count})`,
    `${report.sales.credit_total} ${CURRENCY}`,
  );
  row(
    isEn ? `Cancellations (${report.sales.void_count})` : `Annulations (${report.sales.void_count})`,
    `${report.sales.void_total} ${CURRENCY}`,
  );
  row(isEn ? 'Customer payments' : 'Encaissements clients', `${report.customer.payments_total} ${CURRENCY}`);
  row(isEn ? 'Refunds' : 'Remboursements', `${report.customer.refunds_total} ${CURRENCY}`);
  row(isEn ? 'Cash in' : 'Entrees de caisse', `${report.movements.cash_in_total} ${CURRENCY}`);
  row(isEn ? 'Cash out' : 'Sorties de caisse', `${report.movements.cash_out_total} ${CURRENCY}`);

  line('-'.repeat(width));

  // 5. Expected / counted / variance, bold.
  bytes.push(ESC, 0x45, 0x01);
  row(isEn ? 'Expected' : 'Theorique', `${report.cash.expected} ${CURRENCY}`);
  row(isEn ? 'Counted' : 'Compte', report.cash.counted ? `${report.cash.counted} ${CURRENCY}` : '-');
  row(isEn ? 'Variance' : 'Ecart', report.cash.variance ? `${report.cash.variance} ${CURRENCY}` : '-');
  bytes.push(ESC, 0x45, 0x00);

  if (report.cash.variance_approved_by) {
    line(`${isEn ? 'Approved by' : 'Approuve par'} : ${report.cash.variance_approved_by}`);
  }

  // 6. Feed and partial cut.
  bytes.push(0x0a, 0x0a, 0x0a, 0x0a);
  bytes.push(GS, 0x56, 0x42, 0x00);

  return bytes;
}
