// WS-I-1 §5.8 / A8 — CSV export. UTF-8 with BOM, CRLF line endings;
// fr/ar use ';' and a decimal comma, en uses ',' and a decimal point, so the
// file opens correctly in French Excel with no import wizard.

import type { Locale } from '../../../shared/i18n';

export interface CsvColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

function separatorFor(locale: Locale): string {
  return locale === 'en' ? ',' : ';';
}

function decimalSeparatorFor(locale: Locale): string {
  return locale === 'en' ? '.' : ',';
}

function formatCsvNumber(raw: unknown, decimalSeparator: string): string {
  if (raw === null || raw === undefined) return '';
  const text = String(raw);
  return decimalSeparator === '.' ? text : text.replace('.', decimalSeparator);
}

function csvCell(text: string, separator: string): string {
  const needsQuoting = text.includes(separator) || text.includes('"') || text.includes('\n') || text.includes('\r');
  if (!needsQuoting) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

// `T extends object` rather than `Record<string, unknown>`: see the same
// note in ReportTable.tsx — plain DTO interfaces have no index signature,
// so the cast happens once here instead of at every call site.
export function toCsv<T extends object = Record<string, unknown>>(
  columns: CsvColumn[],
  rows: T[],
  locale: Locale,
): string {
  const separator = separatorFor(locale);
  const decimalSeparator = decimalSeparatorFor(locale);
  const lines: string[] = [columns.map((c) => csvCell(c.label, separator)).join(separator)];
  for (const row of rows) {
    const cells = columns.map((c) => {
      const raw = (row as Record<string, unknown>)[c.key];
      const text = c.numeric ? formatCsvNumber(raw, decimalSeparator) : String(raw ?? '');
      return csvCell(text, separator);
    });
    lines.push(cells.join(separator));
  }
  return lines.map((line) => `${line}\r\n`).join('');
}

const BOM = String.fromCharCode(0xfeff);

export function csvBytes(text: string): Uint8Array {
  return new TextEncoder().encode(BOM + text);
}
