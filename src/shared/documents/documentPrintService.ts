/**
 * Shared Document Printing and Native File Saving Service
 *
 * Provides:
 * 1. Native Windows "Save As" file picker dialog via `@tauri-apps/plugin-dialog`
 *    and Rust `save_binary_file` IPC, with automatic browser fallback for testing.
 * 2. Clean, isolated hidden <iframe> printing for official full-page A4 documents,
 *    eliminating modal dialog screen captures, dark overlays, and scrollbars.
 * 3. Base HTML generator for official documents and business reports across the ERP.
 */

import { save } from '@tauri-apps/plugin-dialog';
import { saveBinaryFile } from '../ipc/documentGateway';

export interface SaveFileDialogOptions {
  defaultFileName: string;
  bytes: Uint8Array | number[];
  filterName?: string;
  extension?: string;
  mimeType?: string;
}

export interface SaveFileDialogResult {
  saved: boolean;
  path?: string;
}

/**
 * Prompts the user with the native Windows "Save As" file dialog and writes the
 * binary content to the chosen destination path.
 * If running outside Tauri (e.g. browser unit tests), falls back to standard blob download.
 */
export async function saveDocumentFileWithDialog(
  options: SaveFileDialogOptions,
): Promise<SaveFileDialogResult> {
  const {
    defaultFileName,
    bytes,
    filterName = 'PDF Document',
    extension = 'pdf',
    mimeType = 'application/pdf',
  } = options;

  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  try {
    // Check if running inside Tauri desktop environment
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const selectedPath = await save({
        title: `Save ${filterName}`,
        defaultPath: defaultFileName,
        filters: [
          {
            name: filterName,
            extensions: [extension],
          },
        ],
      });

      if (!selectedPath) {
        // User explicitly clicked "Cancel" in the Windows Save dialog
        return { saved: false };
      }

      await saveBinaryFile(selectedPath, uint8);
      return { saved: true, path: selectedPath };
    }
  } catch (err) {
    console.warn('Native dialog save failed or not supported in this runtime, falling back to browser download:', err);
  }

  // Web browser fallback for dev/testing
  try {
    const blob = new Blob([uint8], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { saved: true };
  } catch (blobErr) {
    console.error('Browser fallback download failed:', blobErr);
    throw blobErr;
  }
}

/**
 * Triggers the system print dialog using an isolated, hidden <iframe>.
 * This guarantees that only the full-page official A4 document is printed, with ZERO
 * screenshot borders, dialog wrappers, dark overlays, or scrollbars.
 */
export function printDocumentA4(htmlContent: string): void {
  const printFrame = document.createElement('iframe');
  printFrame.style.position = 'fixed';
  printFrame.style.top = '-10000px';
  printFrame.style.left = '-10000px';
  printFrame.style.width = '210mm';
  printFrame.style.height = '297mm';
  printFrame.style.border = 'none';
  document.body.appendChild(printFrame);

  const frameDoc = printFrame.contentWindow?.document;
  if (!frameDoc) return;

  frameDoc.open();
  frameDoc.write(htmlContent);
  frameDoc.close();

  setTimeout(() => {
    try {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
    } catch (err) {
      console.error('Print execution failed:', err);
    } finally {
      setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame);
        }
      }, 2000);
    }
  }, 350);
}

export interface OfficialDocHtmlOptions {
  title: string;
  subTitle?: string;
  documentNumber: string;
  documentDate: string;
  statusLabel: string;
  isPosted?: boolean;
  locale?: 'en' | 'fr' | 'ar';
  infoCardsHtml: string;
  tableHeaders: string[];
  tableRowsHtml: string;
  totalsRowsHtml: string;
  accountingBoxHtml?: string;
  signatures?: string[];
  footerNote?: string;
}

/**
 * Escapes HTML characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generates official, high-fidelity A4 document HTML with crisp fonts,
 * clean borders, status badges, itemized lines table, totals, and signature blocks.
 */
export function buildOfficialDocumentHtml(opts: OfficialDocHtmlOptions): string {
  const {
    title,
    subTitle = 'Système Intégré de Gestion Commerciale & Comptable',
    documentNumber,
    documentDate,
    statusLabel,
    isPosted = true,
    locale = 'fr',
    infoCardsHtml,
    tableHeaders,
    tableRowsHtml,
    totalsRowsHtml,
    accountingBoxHtml,
    signatures = ['Responsable', 'Validation'],
    footerNote,
  } = opts;

  const isRtl = locale === 'ar';

  const defaultSignatures = isRtl
    ? ['أمين المستودع / المصلحة', 'المستلم / الطرف المعني', 'الإدارة / التأشيرة']
    : locale === 'fr'
    ? ['Service Émetteur', 'Bénéficiaire / Tiers', 'Direction / Visa']
    : ['Issuing Dept', 'Recipient / Party', 'Management / Visa'];

  const sigsToRender = signatures.length > 0 ? signatures : defaultSignatures;

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${isRtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(documentNumber)} - ${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm 12mm 12mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 8.5pt;
      line-height: 1.4;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .a4-container {
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
      padding: 2mm 0;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .brand-col h1 {
      font-size: 22pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .brand-col p {
      font-size: 8pt;
      color: #475569;
    }
    .meta-col {
      text-align: ${isRtl ? 'left' : 'right'};
    }
    .meta-col .doc-type {
      font-size: 14pt;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }
    .meta-col .doc-number {
      font-size: 12pt;
      font-weight: 700;
      font-family: 'Consolas', 'Courier New', monospace;
      color: #1d4ed8;
      margin-bottom: 3px;
    }
    .meta-col .doc-date {
      font-size: 8.5pt;
      color: #475569;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      background: ${isPosted ? '#dcfce7' : '#fef9c3'};
      color: ${isPosted ? '#166534' : '#854d0e'};
      font-weight: 700;
      font-size: 7.5pt;
      border-radius: 3px;
      margin-top: 4px;
      text-transform: uppercase;
      border: 1px solid ${isPosted ? '#bbf7d0' : '#fef08a'};
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .info-card {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 9px 12px;
      background: #f8fafc;
    }
    .info-card-title {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #334155;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
      margin-bottom: 6px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 3px;
      font-size: 8.5pt;
    }
    .info-row span:first-child {
      color: #64748b;
    }
    .info-row span:last-child, .info-row strong {
      color: #0f172a;
      font-weight: 600;
    }
    .table-container {
      margin-bottom: 16px;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    table.data-table th {
      background: #0f172a;
      color: #ffffff;
      padding: 7px 10px;
      text-align: ${isRtl ? 'right' : 'left'};
      font-weight: 600;
      font-size: 8pt;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
    table.data-table th.num, table.data-table td.num {
      text-align: right;
    }
    table.data-table td {
      padding: 6px 10px;
      border-bottom: 1px solid #e2e8f0;
      color: #1e293b;
    }
    table.data-table tr:nth-child(even) td {
      background: #f8fafc;
    }
    .totals-wrapper {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .totals-table {
      width: 280px;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    .totals-table td {
      padding: 4px 8px;
    }
    .totals-table td:last-child {
      text-align: right;
      font-weight: 600;
    }
    .totals-table tr.grand-total {
      border-top: 2px solid #0f172a;
      border-bottom: 2px solid #0f172a;
      font-size: 10.5pt;
      font-weight: 800;
      background: #f1f5f9;
    }
    .totals-table tr.grand-total td {
      padding: 7px 8px;
      color: #0f172a;
    }
    .accounting-box {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 9px 12px;
      background: #f8fafc;
      margin-bottom: 18px;
      page-break-inside: avoid;
    }
    .accounting-box h4 {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      margin-bottom: 5px;
    }
    .accounting-box-grid {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      font-size: 8.5pt;
    }
    .signatures-grid {
      display: grid;
      grid-template-columns: repeat(${sigsToRender.length}, 1fr);
      gap: 12px;
      margin-top: 20px;
      page-break-inside: avoid;
    }
    .signature-card {
      border: 1px dashed #94a3b8;
      border-radius: 4px;
      height: 90px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      font-size: 8pt;
      color: #64748b;
      background: #ffffff;
    }
    .signature-card-title {
      font-weight: 700;
      text-transform: uppercase;
      color: #1e293b;
    }
    .doc-footer {
      margin-top: 18px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="a4-container">
    <header class="doc-header">
      <div class="brand-col">
        <h1>Stockiha</h1>
        <p>${escapeHtml(subTitle)}</p>
        <span class="status-badge">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="meta-col">
        <div class="doc-type">${escapeHtml(title)}</div>
        <div class="doc-number">${escapeHtml(documentNumber)}</div>
        <div class="doc-date">${escapeHtml(documentDate)}</div>
      </div>
    </header>

    ${infoCardsHtml ? `<div class="info-grid">${infoCardsHtml}</div>` : ''}

    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            ${tableHeaders.map((th) => `<th class="${th.toLowerCase().includes('total') || th.toLowerCase().includes('montant') || th.toLowerCase().includes('prix') || th.toLowerCase().includes('cost') || th.toLowerCase().includes('quant') || th.toLowerCase().includes('debit') || th.toLowerCase().includes('credit') ? 'num' : ''}">${escapeHtml(th)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
    </div>

    ${totalsRowsHtml ? `
    <div class="totals-wrapper">
      <table class="totals-table">
        <tbody>
          ${totalsRowsHtml}
        </tbody>
      </table>
    </div>` : ''}

    ${accountingBoxHtml ? `
    <div class="accounting-box">
      ${accountingBoxHtml}
    </div>` : ''}

    <div class="signatures-grid">
      ${sigsToRender.map((sig) => `
        <div class="signature-card">
          <span class="signature-card-title">${escapeHtml(sig)}</span>
          <span>Date & Visa / Signature:</span>
        </div>
      `).join('')}
    </div>

    <footer class="doc-footer">
      <span>Stockiha ERP — ${escapeHtml(documentNumber)}</span>
      <span>${footerNote ? escapeHtml(footerNote) : escapeHtml(documentDate)}</span>
    </footer>
  </div>
</body>
</html>`;
}
