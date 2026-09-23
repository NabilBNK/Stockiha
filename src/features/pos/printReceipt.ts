/**
 * WS-F-002 — decides where a receipt goes and reports what happened.
 * WS-M-2 — the A4 branch now goes through the shared engine.
 *
 * Printing never throws to the caller. A posted sale must not appear to have
 * failed because a printer did.
 */
import { printRawReceipt } from '../../shared/ipc/gateway';
import { printDocumentA4 } from '../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, type OfficialDocumentIdentity } from '../../shared/documents/officialDocument';
import { buildSaleInvoiceModel } from '../../shared/documents/models/saleInvoiceModel';
import { buildSaleVoidModel } from '../../shared/documents/models/saleVoidModel';
import { formatDisplayAmount } from '../../shared/utils/formatters';
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
import { buildThermalReceipt, type ReceiptInput } from './receiptBuilder';
import { buildThermalVoidSlip, type VoidSlipInput } from './voidSlipBuilder';

export type PrintOutcome =
  | { status: 'printed'; target: 'THERMAL' | 'A4' }
  | { status: 'disabled' }
  | { status: 'failed'; reason: string };

const A4_TITLE: Record<'fr' | 'ar' | 'en', string> = {
  fr: 'Facture',
  ar: 'فاتورة',
  en: 'Invoice',
};

const VOID_TITLE: Record<'fr' | 'ar' | 'en', string> = {
  fr: 'Annulation de vente',
  ar: 'إلغاء بيع',
  en: 'Sale Cancellation',
};

export async function printSaleReceipt(
  input: ReceiptInput,
  settings: PrintingSettingsDto | null,
  identity: OfficialDocumentIdentity | null = null,
): Promise<PrintOutcome> {
  if (!settings || !settings.receipt_printing_enabled) {
    return { status: 'disabled' };
  }

  try {
    if (settings.receipt_target === 'A4') {
      if (!identity) return { status: 'failed', reason: 'PRINT_IDENTITY_UNAVAILABLE' };
      const model = buildSaleInvoiceModel(
        {
          title: A4_TITLE[identity.printLocale],
          documentNumber: input.documentNumber,
          documentDateText: input.documentTime ? `${input.documentDate} ${input.documentTime}` : input.documentDate,
          customerName: input.customerName,
          cashierName: input.cashierName,
          paymentLabel: input.paymentLabel,
          lines: input.lines.map((line) => ({
            designation: line.name,
            quantity: String(line.qty),
            unitPrice: formatDisplayAmount(line.unitPrice),
            lineTotal: formatDisplayAmount(line.lineTotal),
          })),
          subtotal: input.subtotal ? formatDisplayAmount(input.subtotal) : null,
          discount: input.discount ?? null,
          total: formatDisplayAmount(input.total),
          totalNumeric: input.total,
        },
        identity.printLocale,
      );
      printDocumentA4(renderOfficialDocumentHtml(model, identity));
      return { status: 'printed', target: 'A4' };
    }

    const printerName = settings.thermal_printer_name?.trim() ?? '';
    if (!printerName) {
      return { status: 'failed', reason: 'NO_PRINTER_NAME' };
    }

    await printRawReceipt(printerName, buildThermalReceipt(input, settings));
    return { status: 'printed', target: 'THERMAL' };
  } catch (error: unknown) {
    return { status: 'failed', reason: error instanceof Error ? error.message : 'PRINT_FAILED' };
  }
}

export async function printVoidSlip(
  input: VoidSlipInput,
  settings: PrintingSettingsDto | null,
  identity: OfficialDocumentIdentity | null = null,
): Promise<PrintOutcome> {
  if (!settings || !settings.receipt_printing_enabled) {
    return { status: 'disabled' };
  }

  try {
    if (settings.receipt_target === 'A4') {
      if (!identity) return { status: 'failed', reason: 'PRINT_IDENTITY_UNAVAILABLE' };
      const model = buildSaleVoidModel(
        {
          title: VOID_TITLE[identity.printLocale],
          documentNumber: input.voidNumber,
          documentDateText: input.dateText,
          originalDocumentNumber: input.originalNumber,
          customerName: input.customerName,
          reasonText: input.reasonText,
          lines: input.lines.map((line) => ({
            designation: line.name,
            quantity: line.qty,
            unitPrice: '—',
            lineTotal: formatDisplayAmount(line.lineTotal),
          })),
          total: formatDisplayAmount(input.total),
          totalNumeric: input.total,
        },
        identity.printLocale,
      );
      printDocumentA4(renderOfficialDocumentHtml(model, identity));
      return { status: 'printed', target: 'A4' };
    }

    const printerName = settings.thermal_printer_name?.trim() ?? '';
    if (!printerName) {
      return { status: 'failed', reason: 'NO_PRINTER_NAME' };
    }

    await printRawReceipt(printerName, buildThermalVoidSlip(input, settings));
    return { status: 'printed', target: 'THERMAL' };
  } catch (error: unknown) {
    return { status: 'failed', reason: error instanceof Error ? error.message : 'PRINT_FAILED' };
  }
}
