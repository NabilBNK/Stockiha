/**
 * WS-M-2: purchase receipt A4 print/PDF, now thin wrappers over the shared
 * engine (`officialDocument.ts`) and `purchaseReceiptModel.ts`. The old
 * standalone HTML builder and the duplicated pdf-lib font-loading block
 * have been removed -- every A4 page in the app is produced by exactly one
 * of the two shared renderers (spec §A1).
 */
import type { Locale } from '../../shared/i18n';
import type { PurchaseReceiptLineDto, PurchaseReceiptSummary } from '../../shared/ipc/dto';
import type { OfficialDocumentIdentity } from '../../shared/documents/officialDocument';
import { formatDisplayAmount, formatDisplayDate } from '../../shared/utils/formatters';
import { PROCUREMENT_COPY } from './procurementCopy';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../shared/documents/officialDocument';
import { buildPurchaseReceiptModel } from '../../shared/documents/models/purchaseReceiptModel';

interface ReceiptPrintData {
  receipt: PurchaseReceiptSummary;
  lines: PurchaseReceiptLineDto[];
  locale: Locale;
}

const DOC_TITLE: Record<Locale, string> = {
  fr: 'Bon de réception',
  ar: 'وصل استلام مشتريات',
  en: 'Purchase Receipt',
};

function buildModel(data: ReceiptPrintData, identity: OfficialDocumentIdentity) {
  const { receipt, lines, locale } = data;
  const text = PROCUREMENT_COPY[locale];
  const isDirect = receipt.receipt_origin === 'DIRECT_PURCHASE' || !receipt.purchase_order_id;
  const originText = isDirect
    ? text.directPurchase
    : `${text.purchaseOrderOrigin}: ${receipt.purchase_order_number ?? `#${receipt.purchase_order_id}`}`;

  return buildPurchaseReceiptModel(
    {
      title: DOC_TITLE[locale],
      documentNumber: receipt.document_number,
      documentDateText: formatDisplayDate(receipt.posted_at, locale),
      statusText: 'POSTED',
      supplierName: receipt.supplier_name,
      warehouseName: receipt.warehouse_name,
      purchaseOrderNumber: originText,
      lines: lines.map((line) => ({
        designation: line.variant_name,
        quantity: line.quantity_received,
        unitPrice: formatDisplayAmount(line.unit_cost),
        lineTotal: formatDisplayAmount(line.line_total),
      })),
      total: formatDisplayAmount(receipt.total_amount),
      totalNumeric: receipt.total_amount,
    },
    identity.printLocale,
  );
}

/** Prints the A4 purchase receipt via the shared engine. */
export function printReceiptA4(data: ReceiptPrintData, identity: OfficialDocumentIdentity): void {
  printDocumentA4(renderOfficialDocumentHtml(buildModel(data, identity), identity));
}

/** Downloads the purchase receipt as a PDF via the shared engine. */
export async function downloadReceiptPdf(
  data: ReceiptPrintData,
  identity: OfficialDocumentIdentity,
): Promise<void> {
  const bytes = await renderOfficialDocumentPdf(buildModel(data, identity), identity);
  await saveDocumentFileWithDialog({
    defaultFileName: `Bon_De_Reception_${data.receipt.document_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
    bytes,
    filterName: 'PDF Document',
    extension: 'pdf',
  });
}
