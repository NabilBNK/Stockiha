/**
 * WS-F-006 — builds the cancellation ("annulation") slip for a voided sale,
 * mirroring the layout conventions of receiptBuilder.ts.
 *
 * Money arrives here as decimal strings and is never converted to a number.
 */
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
import { padEnd, padStart, toPrinterBytes } from './receiptBuilder';

export interface VoidSlipInput {
  voidNumber: string;
  originalNumber: string;
  dateText: string; // already formatted, e.g. "22/09/2026 14:05"
  reasonText: string; // already translated reason label (+ " - " + note when a note exists)
  customerName: string | null;
  lines: { name: string; qty: string; lineTotal: string }[];
  total: string; // e.g. "1 200,00"
  currency: string; // "DA"
  locale?: string; // 'en' prints English labels; anything else prints French
}

const ESC = 0x1b;
const GS = 0x1d;

/** Builds the ESC/POS byte payload for one cancellation slip. */
export function buildThermalVoidSlip(input: VoidSlipInput, settings: PrintingSettingsDto): number[] {
  const width = settings.thermal_columns;
  const isEn = input.locale === 'en';
  const bytes: number[] = [];

  const line = (text: string) => {
    bytes.push(...toPrinterBytes(text), 0x0a);
  };

  // 1. Initialise printer. Centre alignment.
  bytes.push(ESC, 0x40);
  bytes.push(ESC, 0x61, 0x01);

  // 2. Shop identity.
  if (settings.shop_name) {
    bytes.push(ESC, 0x45, 0x01);
    line(settings.shop_name);
    bytes.push(ESC, 0x45, 0x00);
  }
  if (settings.shop_address) {
    line(settings.shop_address);
  }
  if (settings.shop_phone) {
    const phone = settings.shop_phone.toLowerCase().startsWith('tel')
      ? settings.shop_phone
      : `Tel: ${settings.shop_phone}`;
    line(phone);
  }

  // 3. Left alignment. A line of '='.
  bytes.push(ESC, 0x61, 0x00);
  line('='.repeat(width));

  // 4. Bold, centred title. Bold off, left alignment.
  bytes.push(ESC, 0x61, 0x01);
  bytes.push(ESC, 0x45, 0x01);
  line(isEn ? 'SALE CANCELLED' : 'ANNULATION DE VENTE');
  bytes.push(ESC, 0x45, 0x00);
  bytes.push(ESC, 0x61, 0x00);

  // 5-9. Metadata.
  line(`${isEn ? 'Cancellation no.' : 'N° annulation'} : ${input.voidNumber}`);
  line(`${isEn ? 'Cancelled sale' : 'Vente annulée'} : ${input.originalNumber}`);
  line(`${isEn ? 'Date' : 'Date'} : ${input.dateText}`);
  if (input.customerName) {
    line(`${isEn ? 'Customer' : 'Client'} : ${input.customerName}`);
  }
  line(`${isEn ? 'Reason' : 'Motif'} : ${input.reasonText}`);

  // 10. Separator.
  line('-'.repeat(width));

  // 11. Lines.
  const nameW = Math.max(8, width - 16);
  input.lines.forEach((l) => {
    line(padEnd(l.name, nameW) + padStart(l.qty, 6) + padStart(l.lineTotal, 10));
  });

  // 12. Separator.
  line('-'.repeat(width));

  // 13. Bold total.
  bytes.push(ESC, 0x45, 0x01);
  const totalLabel = isEn ? 'TOTAL CANCELLED:' : 'TOTAL ANNULE :';
  const totalStr = `${input.total} ${input.currency}`;
  const totalGap = Math.max(1, width - totalLabel.length - totalStr.length);
  line(totalLabel + ' '.repeat(totalGap) + totalStr);
  bytes.push(ESC, 0x45, 0x00);

  // 14. Feed and partial cut.
  bytes.push(0x0a, 0x0a, 0x0a, 0x0a);
  bytes.push(GS, 0x56, 0x42, 0x00);

  return bytes;
}
