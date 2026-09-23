/**
 * Shared Document Printing and Native File Saving Service
 *
 * Provides:
 * 1. Native Windows "Save As" file picker dialog via `@tauri-apps/plugin-dialog`
 *    and Rust `save_binary_file` IPC, with automatic browser fallback for testing.
 * 2. Clean, isolated hidden <iframe> printing for official full-page A4 documents,
 *    eliminating modal dialog screen captures, dark overlays, and scrollbars.
 *
 * WS-M-2: the HTML generator that used to live here (`buildOfficialDocumentHtml`)
 * has moved to `officialDocument.ts` as `renderOfficialDocumentHtml` -- every A4
 * page in the app is now produced by that one shared engine. `escapeHtml` is
 * re-exported below so existing imports keep compiling.
 */

import { save } from '@tauri-apps/plugin-dialog';
import { saveBinaryFile } from '../ipc/documentGateway';

export { escapeHtml } from './officialDocument';

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
