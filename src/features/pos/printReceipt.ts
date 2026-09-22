/**
 * WS-F-002 — decides where a receipt goes and reports what happened.
 *
 * Printing never throws to the caller. A posted sale must not appear to have
 * failed because a printer did.
 */
import { printRawReceipt } from '../../shared/ipc/gateway';
import { printDocumentA4 } from '../../shared/documents/documentPrintService';
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
import { buildA4Receipt, buildThermalReceipt, type ReceiptInput } from './receiptBuilder';
import { buildA4VoidSlip, buildThermalVoidSlip, type VoidSlipInput } from './voidSlipBuilder';

export type PrintOutcome =
  | { status: 'printed'; target: 'THERMAL' | 'A4' }
  | { status: 'disabled' }
  | { status: 'failed'; reason: string };

export async function printSaleReceipt(
  input: ReceiptInput,
  settings: PrintingSettingsDto | null,
): Promise<PrintOutcome> {
  if (!settings || !settings.receipt_printing_enabled) {
    return { status: 'disabled' };
  }

  try {
    if (settings.receipt_target === 'A4') {
      printDocumentA4(buildA4Receipt(input, settings));
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
): Promise<PrintOutcome> {
  if (!settings || !settings.receipt_printing_enabled) {
    return { status: 'disabled' };
  }

  try {
    if (settings.receipt_target === 'A4') {
      printDocumentA4(buildA4VoidSlip(input, settings));
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
