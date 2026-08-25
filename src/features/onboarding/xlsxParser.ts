import type {
  HistoricalBalanceType,
  HistoricalFinanceBalanceInput,
  HistoricalFinanceRowInput,
  HistoricalPaymentStatus,
  HistoricalReviewStatus,
  HistoricalTransactionType,
  HistoricalTradeLineInput,
  HistoricalTradeTransactionInput,
  PaperBookImportProfile,
  PaperBookPaymentStatus,
  PaperBookTransactionType,
} from '../../shared/ipc/onboardingDto';

const MAX_XLSX_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 50 * 1024 * 1024;
const MAX_TRANSACTION_ROWS = 10_000;
const MAX_BALANCE_ROWS = 5_000;
const MAX_REPORTED_ERRORS = 100;

export const HISTORICAL_TRANSACTION_HEADERS = [
  'Paper_ID',
  'Transaction_Date',
  'Transaction_Type',
  'Description_or_Category',
  'Net_Amount_DZD',
  'Payment_Status',
  'Review_Status',
  'Amount_Paid_DZD_Optional',
  'Expense_Category_Optional',
  'Supplier_Fournisseur_Optional',
  'Customer_Client_Optional',
  'Notes_Optional',
] as const;

export const HISTORICAL_BALANCE_HEADERS = [
  'Balance_Date',
  'Balance_Type',
  'Amount_DZD',
  'Review_Status',
  'Supplier_Fournisseur_Optional',
  'Customer_Client_Optional',
  'Notes_Optional',
] as const;

export const PAPER_BOOK_HEADERS = [
  'Txn No. (Auto)',
  'Date',
  'Type',
  'Paid',
  'Party / Company (Optional)',
  'Product Name (Optional)',
  'Brand (Optional)',
  'Custom Details (Optional)',
  'Quantity',
  'Unit Price',
  'Line Total',
  'Page No. (Optional)',
] as const;

export const PAPER_BOOK_V2_HEADERS = [
  'Txn No. (Auto)',
  'Date',
  'Type',
  'Paid',
  'Party / Company (Optional)',
  'Product Name (Optional)',
  'Brand (Optional)',
  'Custom Details (Optional)',
  'Quantity',
  'Unit Price',
  'Line Total',
  'Benefit (Sell Only)',
  'Page No. (Optional)',
] as const;

const TRANSACTION_TYPES = new Set<HistoricalTransactionType>([
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
]);

const PAYMENT_STATUSES = new Set<HistoricalPaymentStatus>([
  'PAID',
  'UNPAID',
  'PARTIAL',
  'UNKNOWN',
]);

const REVIEW_STATUSES = new Set<HistoricalReviewStatus>([
  'READY',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
]);

const BALANCE_TYPES = new Set<HistoricalBalanceType>([
  'OPENING_CASH',
  'CLOSING_CASH',
  'OPENING_BANK',
  'CLOSING_BANK',
  'OPENING_INVENTORY_VALUE',
  'CLOSING_INVENTORY_VALUE',
  'CUSTOMER_RECEIVABLE',
  'SUPPLIER_PAYABLE',
  'LOAN_BALANCE',
  'TAX_PAYABLE',
  'OWNER_CAPITAL',
  'OTHER',
]);

type CellValue = string | number | boolean | null;

export interface RawCellDetails {
  value: CellValue;
  hasFormula: boolean;
  /**
   * The exact characters stored in the cell (`<v>` text for numeric cells, the
   * resolved text for string cells). Money and quantity are read from this and
   * never from `value`, so no IEEE-754 double ever touches the money path.
   */
  rawText: string | null;
  /** True when the cell is stored as a number (not a shared/inline string). */
  isNumeric: boolean;
}

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
}

interface ParsedSheet {
  name: string;
  rows: Map<number, RawCellDetails[]>;
}

export interface HistoricalFinanceImportError {
  sheet: string;
  row: number;
  column?: string;
  message: string;
}

export interface HistoricalFinanceWorkbookData {
  rows: HistoricalFinanceRowInput[];
  balances: HistoricalFinanceBalanceInput[];
  errors: HistoricalFinanceImportError[];
}

export type PaperBookError = HistoricalFinanceImportError;
export type PaperBookTransaction = HistoricalTradeTransactionInput;
export type PaperBookLine = HistoricalTradeLineInput;

/**
 * Counts only. Every monetary and quantity total is computed by PostgreSQL in
 * exact `numeric`/`bigint`; the browser deliberately holds no money aggregate,
 * because React is never authoritative for a financial figure.
 */
export interface PaperBookSummary {
  /** Non-empty spreadsheet rows that were read, including ignored ones. */
  dataRowCount: number;
  /** Rows that were read but produced no line (page-only / spill-over rows). */
  ignoredRowCount: number;
  transactionCount: number;
  lineCount: number;
  totalLines: number;
  salesCount: number;
  purchaseCount: number;
  expenseCount: number;
  manualBenefitCount: number;
  salesWithManualBenefitCount: number;
  salesWithoutManualBenefitCount: number;
  benefitZeroCount: number;
  benefitNegativeCount: number;
  benefitPositiveCount: number;
  minDate: string | null;
  maxDate: string | null;
  unmatchedProductCount: number;
  manualOverrideCount: number;
  missingQtyCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  isPartial: boolean;
  contentHash?: string;
}

export interface PaperBookWorkbookData {
  transactions: HistoricalTradeTransactionInput[];
  errors: HistoricalFinanceImportError[];
  warnings: HistoricalFinanceImportError[];
  /** Per-row validation report shown before anything is staged or committed. */
  rowIssues: HistoricalRowIssue[];
  contentHash: string;
  summary: PaperBookSummary;
}

class WorkbookParseError extends Error {}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    throw new WorkbookParseError('The workbook archive is truncated.');
  }
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw new WorkbookParseError('The workbook archive is truncated.');
  }
  return view.getUint32(offset, true);
}

function validateArchivePath(name: string): void {
  if (
    name.length === 0 ||
    name.startsWith('/') ||
    name.startsWith('\\') ||
    name.includes('\\') ||
    name.includes(':') ||
    name.split('/').some((part) => part === '..')
  ) {
    throw new WorkbookParseError('The workbook archive contains an unsafe path.');
  }
}

function parseCentralDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557);
  let endOffset = -1;

  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }

  if (endOffset < 0) {
    throw new WorkbookParseError('The selected file is not a valid .xlsx archive.');
  }

  const diskNumber = readUint16(view, endOffset + 4);
  const centralDisk = readUint16(view, endOffset + 6);
  const entryCount = readUint16(view, endOffset + 10);
  const centralSize = readUint32(view, endOffset + 12);
  const centralOffset = readUint32(view, endOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0) {
    throw new WorkbookParseError('Multi-disk workbook archives are not supported.');
  }
  if (entryCount > 2_000 || centralOffset + centralSize > bytes.byteLength) {
    throw new WorkbookParseError('The workbook archive exceeds the safe entry limit.');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = new Map<string, ZipEntry>();
  let offset = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) {
      throw new WorkbookParseError('The workbook central directory is malformed.');
    }

    const flags = readUint16(view, offset + 8);
    const compressionMethod = readUint16(view, offset + 10);
    const crc32 = readUint32(view, offset + 16);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const filenameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localHeaderOffset = readUint32(view, offset + 42);

    if ((flags & 0x0001) !== 0) {
      throw new WorkbookParseError('Encrypted workbooks are not supported.');
    }
    if (![0, 8].includes(compressionMethod)) {
      throw new WorkbookParseError('The workbook uses an unsupported compression method.');
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new WorkbookParseError('ZIP64 workbooks are not supported.');
    }

    const nameStart = offset + 46;
    const nameEnd = nameStart + filenameLength;
    if (nameEnd > bytes.byteLength) {
      throw new WorkbookParseError('The workbook filename table is truncated.');
    }

    let name: string;
    try {
      name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    } catch {
      throw new WorkbookParseError('The workbook contains an invalid archive filename.');
    }
    name = name.replace(/^\/+/, '');
    validateArchivePath(name);

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_EXTRACTED_BYTES) {
      throw new WorkbookParseError('The workbook expands beyond the safe size limit.');
    }

    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      crc32,
      localHeaderOffset,
    });

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new WorkbookParseError('This device cannot decompress .xlsx files.');
  }

  const blob = new Blob([bytes]);
  const inputStream = typeof blob.stream === 'function'
    ? blob.stream()
    : new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });

  const stream = inputStream.pipeThrough(
    new DecompressionStream('deflate-raw' as CompressionFormat),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractEntry(
  archiveBytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const view = new DataView(
    archiveBytes.buffer,
    archiveBytes.byteOffset,
    archiveBytes.byteLength,
  );
  const offset = entry.localHeaderOffset;
  if (readUint32(view, offset) !== 0x04034b50) {
    throw new WorkbookParseError(`Workbook entry ${entry.name} has an invalid local header.`);
  }

  const filenameLength = readUint16(view, offset + 26);
  const extraLength = readUint16(view, offset + 28);
  const dataStart = offset + 30 + filenameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archiveBytes.byteLength) {
    throw new WorkbookParseError(`Workbook entry ${entry.name} is truncated.`);
  }

  const compressed = archiveBytes.subarray(dataStart, dataEnd);
  const extracted =
    entry.compressionMethod === 0 ? new Uint8Array(compressed) : await inflateRaw(compressed);

  if (extracted.byteLength !== entry.uncompressedSize) {
    throw new WorkbookParseError(`Workbook entry ${entry.name} has an invalid size.`);
  }
  if (calculateCrc32(extracted) !== entry.crc32) {
    throw new WorkbookParseError(`Workbook entry ${entry.name} failed its integrity check.`);
  }

  return extracted;
}

function parseXml(bytes: Uint8Array, label: string): XMLDocument {
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new WorkbookParseError(`${label} contains malformed XML.`);
  }
  return xml;
}

function elementsByLocalName(parent: ParentNode, localName: string): Element[] {
  return Array.from((parent as Document | Element).getElementsByTagNameNS('*', localName));
}

function normalizeWorkbookTarget(target: string): string {
  const clean = target.replace(/^\/+/, '');
  validateArchivePath(clean);
  return clean.startsWith('xl/') ? clean : `xl/${clean}`;
}

function parseSharedStrings(xml: XMLDocument | null): string[] {
  if (xml === null) return [];
  return elementsByLocalName(xml, 'si').map((item) =>
    elementsByLocalName(item, 't')
      .map((text) => text.textContent ?? '')
      .join(''),
  );
}

function parseDateStyleIndexes(styles: XMLDocument): Set<number> {
  const customFormats = new Map<number, string>();
  for (const format of elementsByLocalName(styles, 'numFmt')) {
    const id = Number(format.getAttribute('numFmtId'));
    const code = format.getAttribute('formatCode') ?? '';
    if (Number.isInteger(id)) customFormats.set(id, code);
  }

  const dateStyles = new Set<number>();
  const cellXfs = elementsByLocalName(styles, 'cellXfs')[0];
  if (!cellXfs) return dateStyles;

  const builtinDateIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  Array.from(cellXfs.children)
    .filter((child) => child.localName === 'xf')
    .forEach((style, index) => {
      const numberFormatId = Number(style.getAttribute('numFmtId') ?? '0');
      const customCode = (customFormats.get(numberFormatId) ?? '')
        .replace(/"[^"]*"/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .toLowerCase();
      if (
        builtinDateIds.has(numberFormatId) ||
        (customCode.includes('y') && customCode.includes('m') && customCode.includes('d'))
      ) {
        dateStyles.add(index);
      }
    });

  return dateStyles;
}

function excelSerialToIsoDate(serial: number): string {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) {
    throw new WorkbookParseError('The workbook contains an invalid Excel date.');
  }
  const milliseconds = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new WorkbookParseError('The workbook contains an invalid Excel date.');
  }
  return date.toISOString().slice(0, 10);
}

function columnIndexFromReference(reference: string): number {
  const match = /^([A-Z]+)[1-9][0-9]*$/.exec(reference.toUpperCase());
  if (!match) throw new WorkbookParseError('The workbook contains an invalid cell reference.');

  let index = 0;
  for (const character of match[1]) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }
  return index - 1;
}

function readCellValueWithDetails(
  cell: Element,
  sharedStrings: string[],
  dateStyles: Set<number>,
): RawCellDetails {
  const hasFormula = elementsByLocalName(cell, 'f').length > 0;
  const type = cell.getAttribute('t') ?? '';
  const valueNode = elementsByLocalName(cell, 'v')[0];
  const raw = valueNode?.textContent ?? '';
  if (raw === '' && type !== 'inlineStr') {
    return { value: null, hasFormula, rawText: null, isNumeric: false };
  }

  if (type === 'inlineStr') {
    const text = elementsByLocalName(cell, 't')
      .map((node) => node.textContent ?? '')
      .join('');
    return { value: text, hasFormula, rawText: text, isNumeric: false };
  }
  if (type === 's') {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      throw new WorkbookParseError('The workbook contains an invalid shared-string reference.');
    }
    const text = sharedStrings[index];
    return { value: text, hasFormula, rawText: text, isNumeric: false };
  }
  if (type === 'str') return { value: raw, hasFormula, rawText: raw, isNumeric: false };
  if (type === 'b') {
    return { value: raw === '1', hasFormula, rawText: raw, isNumeric: false };
  }
  if (type === 'e') throw new WorkbookParseError('The workbook contains an Excel error cell.');
  if (type === 'd') {
    const iso = raw.slice(0, 10);
    return { value: iso, hasFormula, rawText: iso, isNumeric: false };
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return { value: raw, hasFormula, rawText: raw, isNumeric: false };
  }
  const styleIndex = Number(cell.getAttribute('s') ?? '0');
  // `value` stays a JS number only for non-money uses (dates, page numbers).
  // `rawText` keeps the untouched stored characters for the money path.
  const value = dateStyles.has(styleIndex) ? excelSerialToIsoDate(numeric) : numeric;
  return { value, hasFormula, rawText: raw, isNumeric: true };
}

function parseSheet(
  name: string,
  xml: XMLDocument,
  sharedStrings: string[],
  dateStyles: Set<number>,
): ParsedSheet {
  const rows = new Map<number, RawCellDetails[]>();
  for (const rowElement of elementsByLocalName(xml, 'row')) {
    const rowNumber = Number(rowElement.getAttribute('r'));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      throw new WorkbookParseError(`${name} contains an invalid row number.`);
    }

    const values: RawCellDetails[] = [];
    for (const cell of Array.from(rowElement.children).filter(
      (child) => child.localName === 'c',
    )) {
      const reference = cell.getAttribute('r');
      if (!reference) throw new WorkbookParseError(`${name} contains an unaddressed cell.`);
      const columnIndex = columnIndexFromReference(reference);
      if (columnIndex > 100) {
        throw new WorkbookParseError(`${name} contains data beyond the supported columns.`);
      }
      values[columnIndex] = readCellValueWithDetails(cell, sharedStrings, dateStyles);
    }
    rows.set(rowNumber, values);
  }
  return { name, rows };
}

function normalizeString(value: CellValue): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function optionalString(value: CellValue): string | null {
  const normalized = normalizeString(value);
  return normalized === '' ? null : normalized;
}

// --- Exact decimal handling (WS-G) --------------------------------------
// Every helper below works on characters only. There is deliberately no
// Number(), parseFloat(), parseInt() or arithmetic operator anywhere in the
// money/quantity path: the exact characters stored in the cell travel through
// TypeScript and the IPC boundary as strings, and PostgreSQL does the maths.

const DECIMAL_PATTERN = /^[+-]?(?:\d+)(?:\.\d*)?$/;

/**
 * Canonicalises the exact characters of a numeric cell without arithmetic:
 * strips a leading `+`, leading zeros, trailing fractional zeros and a
 * trailing decimal point, and collapses a signed zero. `"160.0"` becomes
 * `"160"`, `"1.60"` becomes `"1.6"`, `"-0.0"` becomes `"0"`.
 * Returns `null` when the text is not a plain decimal literal.
 */
export function canonicalDecimalText(text: string): string | null {
  const trimmed = text.trim().replace(/[\s\u00a0\u202f]/g, '');
  if (trimmed === '' || !DECIMAL_PATTERN.test(trimmed)) return null;

  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [rawInteger, rawFraction = ''] = unsigned.split('.');

  const integerPart = rawInteger.replace(/^0+(?=\d)/, '');
  const fractionPart = rawFraction.replace(/0+$/, '');

  const magnitude = fractionPart === '' ? integerPart : `${integerPart}.${fractionPart}`;
  if (/^0$/.test(magnitude)) return '0';
  return negative ? `-${magnitude}` : magnitude;
}

/** True when a canonical decimal string carries no fractional part. */
function isWholeDecimal(canonical: string): boolean {
  return !canonical.includes('.');
}

/** True when a canonical decimal string is exactly zero. */
function isZeroDecimal(canonical: string): boolean {
  return canonical === '0';
}

/** True when a canonical decimal string is strictly negative. */
function isNegativeDecimal(canonical: string): boolean {
  return canonical.startsWith('-');
}

/**
 * Reads a cell as the exact text the workbook stores. Numeric cells return the
 * canonicalised `<v>` characters; string cells return the trimmed text.
 * Returns `null` for a blank cell — blank always means unknown (rule 9).
 */
function exactCellText(cell: RawCellDetails | undefined): string | null {
  if (!cell) return null;
  if (cell.rawText === null) return null;
  if (cell.isNumeric) return canonicalDecimalText(cell.rawText);
  const trimmed = cell.rawText.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Reads a money or quantity cell as an exact decimal string. Non-numeric text
 * is accepted only when it is itself a plain decimal literal (hand-typed
 * amounts pasted as text), so that a genuinely malformed amount surfaces as a
 * defect instead of being silently coerced.
 */
function exactAmountText(cell: RawCellDetails | undefined): string | null | 'INVALID' {
  if (!cell || cell.rawText === null) return null;
  const trimmed = cell.rawText.trim();
  if (trimmed === '') return null;
  const canonical = canonicalDecimalText(trimmed);
  return canonical ?? 'INVALID';
}

// --- Per-row validation report (WS-G scope item 3) -----------------------

export type HistoricalRowIssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface HistoricalRowIssue {
  severity: HistoricalRowIssueSeverity;
  sheet: string;
  /** 1-based Excel row number as shown to the user in Excel. */
  row: number;
  /** Human column heading, e.g. `Date`. Absent when the whole row is at fault. */
  column?: string;
  /** What is wrong, in plain French. */
  probleme: string;
  /** What the user should do about it, in plain French. */
  action: string;
  /** True when the row is dropped from the import until it is corrected. */
  blocksRow: boolean;
  /** True when the row imports only after the user explicitly confirms it. */
  requiresConfirmation: boolean;
}

function parseInteger(value: CellValue, field: string, allowZero: boolean): number {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else {
    const normalized = normalizeString(value).replace(/[\s\u00a0,]/g, '');
    if (!/^-?\d+$/.test(normalized)) throw new Error(`${field} must be a whole DZD amount.`);
    parsed = Number(normalized);
  }

  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`${field} is outside the allowed whole-DZD range.`);
  }
  return parsed;
}

function parseOptionalInteger(value: CellValue, field: string): number | null {
  if (normalizeString(value) === '') return null;
  return parseInteger(value, field, true);
}

function parseIsoDate(value: CellValue, field: string): string {
  const normalized = normalizeString(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${field} must use YYYY-MM-DD.`);
  const date = new Date(`${normalized}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`${field} is not a valid calendar date.`);
  }
  return normalized;
}

function pushError(
  errors: HistoricalFinanceImportError[],
  error: HistoricalFinanceImportError,
): void {
  if (errors.length < MAX_REPORTED_ERRORS) errors.push(error);
}

function assertHeaders(sheet: ParsedSheet, expected: readonly string[]): void {
  const actual = sheet.rows.get(1) ?? [];
  expected.forEach((header, index) => {
    if (normalizeString(actual[index]?.value) !== header) {
      throw new WorkbookParseError(
        `${sheet.name} column ${index + 1} must be named ${header}. Use the official Stockiha template.`,
      );
    }
  });
}

function assertPaperBookHeaders(sheet: ParsedSheet): PaperBookImportProfile {
  const actual = sheet.rows.get(1) ?? [];
  const actualValues = actual.map((c) => normalizeString(c?.value));

  if (actualValues.length >= 13 || actualValues.some((v) => v.includes('Benefit'))) {
    PAPER_BOOK_V2_HEADERS.forEach((header, index) => {
      if (actualValues[index] !== header) {
        throw new WorkbookParseError(
          `${sheet.name} column ${index + 1} must be named ${header}. Use the official Stockiha template.`,
        );
      }
    });
    return 'PAPER_BOOK_V2';
  }

  PAPER_BOOK_HEADERS.forEach((header, index) => {
    if (actualValues[index] !== header) {
      throw new WorkbookParseError(
        `${sheet.name} column ${index + 1} must be named ${header}. Use the official Stockiha template.`,
      );
    }
  });
  return 'PAPER_BOOK_V1';
}

function isEmptyDataRow(values: RawCellDetails[], columnCount: number): boolean {
  for (let index = 0; index < columnCount; index += 1) {
    if (normalizeString(values[index]?.value) !== '') return false;
  }
  return true;
}

// Compute deterministic SHA-256 fingerprint over canonical JSON serialization of parsed transactions
export async function computeContentHash(transactions: HistoricalTradeTransactionInput[]): Promise<string> {
  const canonicalStr = JSON.stringify(
    transactions.map((t) => ({
      d: t.transactionDate,
      t: t.transactionType,
      p: t.paymentStatus,
      c: t.partyCompany,
      b: t.manualBenefitDzd,
      pg: t.pageNumber,
      l: t.lines.map((l) => ({
        pn: l.productName,
        b: l.brand,
        cd: l.customDetails,
        pc: l.partyCompany,
        mb: l.manualBenefitDzd,
        q: l.quantity,
        u: l.unitPriceDzd,
        m: l.manualLineTotalDzd,
      })),
    })),
  );
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Date parser supporting DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, and safe Excel serial integer dates
function parsePaperBookDate(value: string, rowNumber: number): string {
  const trimmed = value.trim();
  const ddMmYyyy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (ddMmYyyy) {
    const day = ddMmYyyy[1].padStart(2, '0');
    const month = ddMmYyyy[2].padStart(2, '0');
    const year = ddMmYyyy[3];
    return parseIsoDate(`${year}-${month}-${day}`, `Row ${rowNumber} Date`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseIsoDate(trimmed, `Row ${rowNumber} Date`);
  }
  if (/^\d{5}$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return excelSerialToIsoDate(numeric);
    }
  }
  throw new Error(`Row ${rowNumber} · Date: "${value}" is not a valid date. Expected DD/MM/YYYY, for example 23/11/2025.`);
}

const COLUMN_LETTERS = 'ABCDEFGHIJKLM';

function cellRef(columnIndex: number, rowNumber: number): string {
  return `${COLUMN_LETTERS[columnIndex] ?? '?'}${rowNumber}`;
}

export interface PaperBookIssueSink {
  errors: HistoricalFinanceImportError[];
  warnings: HistoricalFinanceImportError[];
  issues: HistoricalRowIssue[];
}

function addIssue(
  sink: PaperBookIssueSink,
  issue: Omit<HistoricalRowIssue, 'blocksRow' | 'requiresConfirmation'> &
    Partial<Pick<HistoricalRowIssue, 'blocksRow' | 'requiresConfirmation'>>,
): void {
  const complete: HistoricalRowIssue = {
    blocksRow: issue.severity === 'ERROR',
    requiresConfirmation: issue.severity === 'WARNING',
    ...issue,
  };
  sink.issues.push(complete);

  // Legacy flat lists kept so the existing screen keeps working unchanged.
  const legacy: HistoricalFinanceImportError = {
    sheet: complete.sheet,
    row: complete.row,
    column: complete.column,
    message: `${complete.probleme} ${complete.action}`,
  };
  if (complete.severity === 'ERROR') pushError(sink.errors, legacy);
  else if (complete.severity === 'WARNING') sink.warnings.push(legacy);
}

/** Today in ISO form. Injectable so the future-date rule is testable. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeType(value: string, rowNumber: number): PaperBookTransactionType {
  const upper = value.trim().toUpperCase();
  if (upper === 'SELL' || upper === 'SALE') return 'SALE';
  if (upper === 'BUY' || upper === 'PURCHASE') return 'PURCHASE';
  if (upper === 'EXPENSE') return 'EXPENSE';
  throw new Error(`Row ${rowNumber}: Invalid transaction type '${value}'. Only Sell, Buy, or Expense allowed.`);
}

function normalizePaid(value: string, rowNumber: number): PaperBookPaymentStatus {
  const upper = value.trim().toUpperCase();
  if (upper === 'PAID') return 'PAID';
  if (upper === 'NOT PAID' || upper === 'UNPAID' || upper === 'NOTPAID') return 'UNPAID';
  throw new Error(`Row ${rowNumber}: Invalid payment status '${value}'. Only Paid or Not Paid allowed.`);
}

export interface PaperBookSheetOutcome {
  transactions: HistoricalTradeTransactionInput[];
  dataRowCount: number;
  ignoredRowCount: number;
  typedLineTotalCount: number;
}

/**
 * A cell holds user content when it is non-blank. A formula cell whose cached
 * value is exactly zero is template spill-over (the `=I*J` filled down over the
 * empty tail of the table) and is NOT user content.
 */
function cellHasContent(cell: RawCellDetails | undefined): boolean {
  if (!cell || cell.rawText === null) return false;
  const text = cell.rawText.trim();
  if (text === '') return false;
  if (!cell.hasFormula) return true;
  const canonical = cell.isNumeric ? canonicalDecimalText(text) : null;
  return canonical === null || !isZeroDecimal(canonical);
}

export function parsePaperBookSheet(
  sheet: ParsedSheet,
  sink: PaperBookIssueSink,
  profile: PaperBookImportProfile = 'PAPER_BOOK_V2',
  today: string = todayIso(),
): PaperBookSheetOutcome {
  const transactions: HistoricalTradeTransactionInput[] = [];
  const sortedRows = [...sheet.rows.entries()].sort((a, b) => a[0] - b[0]);

  let activeTxn: HistoricalTradeTransactionInput | null = null;
  let txnSequence = 0;
  let dataRowCount = 0;
  let ignoredRowCount = 0;
  let typedLineTotalCount = 0;

  const isV2 = profile === 'PAPER_BOOK_V2';
  const headers = isV2 ? PAPER_BOOK_V2_HEADERS : PAPER_BOOK_HEADERS;
  const colCount = headers.length;
  const benefitCol = isV2 ? 11 : -1;
  const pageCol = isV2 ? 12 : 11;

  // Iteration is by row number only, to read the sheet top to bottom. Grouping
  // depends solely on column C (rule 2) and never on the dates (rule 8).
  for (const [rowNumber, cells] of sortedRows) {
    if (rowNumber === 1) continue;

    let rowHasContent = false;
    for (let index = 1; index < colCount; index += 1) {
      if (cellHasContent(cells[index])) {
        rowHasContent = true;
        break;
      }
    }
    if (!rowHasContent) continue;
    dataRowCount += 1;

    // Rule 1: column A is a formula and is never parsed. Column K may legally
    // be a formula. A formula anywhere else means the template was altered.
    cells.forEach((cell, colIdx) => {
      if (colIdx !== 0 && colIdx !== 10 && colIdx < colCount && cell?.hasFormula) {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: headers[colIdx],
          probleme: `La cellule ${cellRef(colIdx, rowNumber)} contient une formule, ce qui n'est pas autorisé dans la colonne « ${headers[colIdx]} ».`,
          action: 'Remplacez la formule par la valeur écrite sur le papier, puis relancez l\'import.',
        });
      }
    });

    const dateStr = normalizeString(cells[1]?.value);
    const typeStr = normalizeString(cells[2]?.value);
    const paidStr = normalizeString(cells[3]?.value);
    const partyStr = exactCellText(cells[4]);

    const benefitRaw = benefitCol >= 0 ? exactAmountText(cells[benefitCol]) : null;
    let benefitVal: string | null = null;
    if (benefitRaw === 'INVALID') {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Benefit (Sell Only)',
        probleme: `Le bénéfice écrit en ${cellRef(benefitCol, rowNumber)} n'est pas un montant lisible.`,
        action: 'Saisissez un montant en dinars entiers, par exemple 7000, ou laissez la case vide si le bénéfice est inconnu.',
      });
    } else if (benefitRaw !== null && !isWholeDecimal(benefitRaw)) {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Benefit (Sell Only)',
        probleme: `Le bénéfice écrit en ${cellRef(benefitCol, rowNumber)} contient des centimes (${benefitRaw}).`,
        action: 'Arrondissez au dinar entier tel qu\'il figure sur le cahier.',
      });
    } else {
      benefitVal = benefitRaw;
    }

    const pageRaw = exactAmountText(cells[pageCol]);
    let pageNoVal: string | null = null;
    if (pageRaw === 'INVALID' || (pageRaw !== null && !isWholeDecimal(pageRaw))) {
      addIssue(sink, {
        severity: 'WARNING',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Page No. (Optional)',
        probleme: `Le numéro de page en ${cellRef(pageCol, rowNumber)} n'est pas un nombre entier.`,
        action: 'Saisissez le numéro de page du cahier, ou laissez la case vide.',
      });
    } else {
      pageNoVal = pageRaw;
    }

    if (typeStr !== '') {
      // Rule 2: Type filled = start of a new transaction.
      let normType: PaperBookTransactionType;
      let normPaid: PaperBookPaymentStatus;
      let isoDate: string;

      if (dateStr === '') {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Date',
          probleme: `La ligne ${rowNumber} ouvre une nouvelle opération mais la date en ${cellRef(1, rowNumber)} est vide.`,
          action: 'Saisissez la date de l\'opération au format JJ/MM/AAAA, par exemple 15/05/2025.',
        });
        continue;
      }
      try {
        isoDate = parsePaperBookDate(dateStr, rowNumber);
      } catch {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Date',
          probleme: `La date « ${dateStr} » écrite en ${cellRef(1, rowNumber)} n'est pas une date valide.`,
          action: 'Corrigez la cellule au format JJ/MM/AAAA, par exemple 15/05/2025, puis relancez l\'import.',
        });
        continue;
      }
      try {
        normType = normalizeType(typeStr, rowNumber);
      } catch {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Type',
          probleme: `Le type « ${typeStr} » écrit en ${cellRef(2, rowNumber)} n'est pas reconnu.`,
          action: 'Écrivez exactement Sell, Buy ou Expense.',
        });
        continue;
      }
      try {
        normPaid = normalizePaid(paidStr, rowNumber);
      } catch {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Paid',
          probleme:
            paidStr === ''
              ? `Le statut de paiement en ${cellRef(3, rowNumber)} est vide.`
              : `Le statut de paiement « ${paidStr} » écrit en ${cellRef(3, rowNumber)} n'est pas reconnu.`,
          action: 'Écrivez exactement Paid ou Not Paid.',
        });
        continue;
      }

      // A date later than today is almost always a year typo on the paper.
      // It is a warning, not a rejection: the owner confirms or corrects it.
      if (isoDate > today) {
        addIssue(sink, {
          severity: 'WARNING',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Date',
          probleme: `La date du ${isoDate} écrite en ${cellRef(1, rowNumber)} est dans le futur.`,
          action: 'Vérifiez l\'année sur le cahier. Corrigez-la, ou confirmez que cette date future est bien voulue avant d\'importer.',
        });
      }

      if (normType !== 'SALE' && benefitVal !== null) {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Benefit (Sell Only)',
          probleme: `Un bénéfice est écrit en ${cellRef(benefitCol, rowNumber)} alors que l'opération est de type ${typeStr}.`,
          action: 'Le bénéfice ne se note que sur les ventes. Videz la case, ou corrigez le type de l\'opération.',
        });
      }

      txnSequence += 1;
      activeTxn = {
        sourceTransactionSequence: txnSequence,
        sourceFirstExcelRow: rowNumber,
        // Column A is read only as an opaque label for tracing back to the
        // sheet. It never takes part in grouping (rule 1).
        sourceExcelTxnRef: exactCellText(cells[0]),
        transactionDate: isoDate,
        transactionType: normType,
        paymentStatus: normPaid,
        partyCompany: partyStr,
        // Rule 6: blank stays blank. Blank is not zero.
        manualBenefitDzd: normType === 'SALE' ? benefitVal : null,
        pageNumber: pageNoVal,
        lines: [],
      };
      transactions.push(activeTxn);
    } else {
      // Rule 2: Type blank = continuation of the transaction above.
      if (!activeTxn) {
        addIssue(sink, {
          severity: 'WARNING',
          sheet: sheet.name,
          row: rowNumber,
          probleme: `La ligne ${rowNumber} contient des données mais aucune opération n'a été ouverte au-dessus d'elle.`,
          action: 'Renseignez le Type (Sell, Buy ou Expense) sur cette ligne, sinon elle sera ignorée.',
        });
        ignoredRowCount += 1;
        continue;
      }

      // Rule 3: these fields belong on the first row only. When a continuation
      // row repeats one of them we check it instead of silently overwriting.
      if (dateStr !== '') {
        try {
          const isoDate = parsePaperBookDate(dateStr, rowNumber);
          if (isoDate !== activeTxn.transactionDate) {
            addIssue(sink, {
              severity: 'ERROR',
              sheet: sheet.name,
              row: rowNumber,
              column: 'Date',
              probleme: `La date du ${isoDate} en ${cellRef(1, rowNumber)} contredit la date du ${activeTxn.transactionDate} de l'opération commencée ligne ${activeTxn.sourceFirstExcelRow}.`,
              action: 'Laissez la date vide sur les lignes de suite, ou ouvrez une nouvelle opération en renseignant le Type.',
            });
          }
        } catch {
          addIssue(sink, {
            severity: 'WARNING',
            sheet: sheet.name,
            row: rowNumber,
            column: 'Date',
            probleme: `La date « ${dateStr} » en ${cellRef(1, rowNumber)} n'est pas lisible.`,
            action: 'Sur une ligne de suite la date doit rester vide. Videz la cellule ou corrigez-la au format JJ/MM/AAAA.',
          });
        }
      }
      if (paidStr !== '') {
        try {
          const normPaid = normalizePaid(paidStr, rowNumber);
          if (normPaid !== activeTxn.paymentStatus) {
            addIssue(sink, {
              severity: 'ERROR',
              sheet: sheet.name,
              row: rowNumber,
              column: 'Paid',
              probleme: `Le statut « ${paidStr} » en ${cellRef(3, rowNumber)} contredit celui de l'opération commencée ligne ${activeTxn.sourceFirstExcelRow}.`,
              action: 'Laissez la case Paid vide sur les lignes de suite.',
            });
          }
        } catch {
          addIssue(sink, {
            severity: 'WARNING',
            sheet: sheet.name,
            row: rowNumber,
            column: 'Paid',
            probleme: `Le statut de paiement « ${paidStr} » en ${cellRef(3, rowNumber)} n'est pas reconnu.`,
            action: 'Sur une ligne de suite la case Paid doit rester vide.',
          });
        }
      }
      if (partyStr !== null && activeTxn.partyCompany === null) {
        activeTxn.partyCompany = partyStr;
      }
      if (
        pageNoVal !== null &&
        activeTxn.pageNumber !== null &&
        pageNoVal !== activeTxn.pageNumber
      ) {
        addIssue(sink, {
          severity: 'WARNING',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Page No. (Optional)',
          probleme: `Le numéro de page ${pageNoVal} en ${cellRef(pageCol, rowNumber)} contredit la page ${activeTxn.pageNumber} de l'opération commencée ligne ${activeTxn.sourceFirstExcelRow}.`,
          action: 'Laissez le numéro de page vide sur les lignes de suite, il est déjà noté sur la première ligne.',
        });
      }
      if (benefitVal !== null) {
        addIssue(sink, {
          severity: 'WARNING',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Benefit (Sell Only)',
          probleme: `Un bénéfice est écrit en ${cellRef(benefitCol, rowNumber)} sur une ligne de suite.`,
          action: 'Le bénéfice se note une seule fois, sur la première ligne de la vente. Ce montant n\'est pas repris dans le bénéfice de l\'opération.',
        });
      }
    }

    // --- product / amount line -------------------------------------------
    const productName = exactCellText(cells[5]);
    const brand = exactCellText(cells[6]);
    // Rule 7: Custom Details may arrive as a number. The exact characters the
    // workbook stores are kept as text; no numeric conversion takes place.
    const customDetailsCell = cells[7];
    const customDetails = exactCellText(customDetailsCell);
    if (customDetails !== null && customDetailsCell?.isNumeric) {
      addIssue(sink, {
        severity: 'INFO',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Custom Details (Optional)',
        probleme: `La précision « ${customDetails} » en ${cellRef(7, rowNumber)} est enregistrée comme un nombre et non comme du texte.`,
        action: `Aucune action requise : elle est reprise telle quelle, « ${customDetails} ».`,
      });
    }

    const isExpense = activeTxn.transactionType === 'EXPENSE';

    const qtyRaw = exactAmountText(cells[8]);
    let quantity: string | null = null;
    if (qtyRaw === 'INVALID') {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Quantity',
        probleme: `La quantité écrite en ${cellRef(8, rowNumber)} n'est pas un nombre lisible.`,
        action: 'Saisissez un nombre entier de pièces, par exemple 12.',
      });
    } else if (qtyRaw !== null && !isWholeDecimal(qtyRaw)) {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Quantity',
        probleme: `La quantité ${qtyRaw} en ${cellRef(8, rowNumber)} n'est pas un nombre entier de pièces.`,
        action: 'Saisissez un nombre entier, par exemple 12.',
      });
    } else if (qtyRaw !== null && (isZeroDecimal(qtyRaw) || isNegativeDecimal(qtyRaw))) {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Quantity',
        probleme: `La quantité ${qtyRaw} en ${cellRef(8, rowNumber)} doit être supérieure à zéro.`,
        action: 'Corrigez la quantité, ou laissez la case vide si seule la somme totale est connue.',
      });
    } else {
      quantity = qtyRaw;
    }

    const priceRaw = exactAmountText(cells[9]);
    let unitPriceDzd: string | null = null;
    if (priceRaw === 'INVALID') {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Unit Price',
        probleme: `Le prix unitaire écrit en ${cellRef(9, rowNumber)} n'est pas un montant lisible.`,
        action: 'Saisissez un montant en dinars entiers, par exemple 9200.',
      });
    } else if (priceRaw !== null && !isWholeDecimal(priceRaw)) {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Unit Price',
        probleme: `Le prix unitaire ${priceRaw} en ${cellRef(9, rowNumber)} contient des centimes.`,
        action: 'Arrondissez au dinar entier tel qu\'il figure sur le cahier.',
      });
    } else if (priceRaw !== null && isNegativeDecimal(priceRaw)) {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Unit Price',
        probleme: `Le prix unitaire ${priceRaw} en ${cellRef(9, rowNumber)} est négatif.`,
        action: 'Saisissez un montant positif.',
      });
    } else {
      unitPriceDzd = priceRaw;
    }

    // Rule 4: column K wins. Its cached value is used whether the cell holds a
    // formula or a hand-typed amount. Nothing is recomputed here.
    const lineTotalCell = cells[10];
    // A `=I*J` formula filled down over empty rows caches a zero. That is
    // template spill-over, not an amount of zero dinars written on the paper.
    const lineTotalRaw = cellHasContent(lineTotalCell) ? exactAmountText(lineTotalCell) : null;
    let manualLineTotalDzd: string | null = null;
    if (lineTotalRaw === 'INVALID') {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Line Total',
        probleme: `Le total écrit en ${cellRef(10, rowNumber)} n'est pas un montant lisible.`,
        action: 'Saisissez le montant total de la ligne en dinars entiers.',
      });
    } else if (lineTotalRaw !== null && !isWholeDecimal(lineTotalRaw)) {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Line Total',
        probleme: `Le total ${lineTotalRaw} en ${cellRef(10, rowNumber)} contient des centimes.`,
        action: 'Arrondissez au dinar entier tel qu\'il figure sur le cahier.',
      });
    } else if (lineTotalRaw !== null && isNegativeDecimal(lineTotalRaw)) {
      addIssue(sink, {
        severity: 'ERROR',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Line Total',
        probleme: `Le total ${lineTotalRaw} en ${cellRef(10, rowNumber)} est négatif.`,
        action: 'Saisissez un montant positif.',
      });
    } else if (lineTotalRaw !== null) {
      manualLineTotalDzd = lineTotalRaw;
      if (lineTotalCell && !lineTotalCell.hasFormula) typedLineTotalCount += 1;
    }

    // A row that carries no product, no quantity, no price and no amount is
    // not a line at all (rule 2 continuation with nothing on it). It must never
    // become an invented transaction or a zero-value line.
    const hasLineSubstance =
      productName !== null ||
      brand !== null ||
      customDetails !== null ||
      quantity !== null ||
      unitPriceDzd !== null ||
      manualLineTotalDzd !== null;

    if (!hasLineSubstance) {
      ignoredRowCount += 1;
      addIssue(sink, {
        severity: 'WARNING',
        sheet: sheet.name,
        row: rowNumber,
        probleme:
          pageNoVal !== null
            ? `La ligne ${rowNumber} ne contient qu'un numéro de page (${pageNoVal}), sans produit ni montant.`
            : `La ligne ${rowNumber} ne contient aucun produit ni montant.`,
        action: 'Elle est ignorée : aucune opération ni ligne n\'a été créée. Complétez-la si un produit ou un montant manque.',
      });
      continue;
    }

    if (manualLineTotalDzd === null && lineTotalCell?.hasFormula) {
      // A formula with no cached value: the file was written by a script and
      // never opened in Excel. PostgreSQL recomputes quantity x unit price.
      addIssue(sink, {
        severity: 'WARNING',
        sheet: sheet.name,
        row: rowNumber,
        column: 'Line Total',
        probleme: `La formule du total en ${cellRef(10, rowNumber)} n'a pas de résultat enregistré.`,
        action: 'Le total sera recalculé à partir de la quantité et du prix unitaire. Ouvrez le fichier dans Excel et enregistrez-le pour figer le montant du cahier.',
      });
    }

    // Rule 5 / rule 9: an amount-only expense line is legitimate, but a line
    // with no amount at all is a defect, never a silent zero.
    if (isExpense) {
      if (manualLineTotalDzd === null && (quantity === null || unitPriceDzd === null)) {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Line Total',
          probleme: `La dépense de la ligne ${rowNumber} n'a pas de montant en ${cellRef(10, rowNumber)}.`,
          action: 'Saisissez le montant de la dépense dans la colonne Line Total.',
        });
      }
    } else {
      if (quantity === null && manualLineTotalDzd === null) {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Quantity',
          probleme: `La ligne ${rowNumber} n'a ni quantité ni montant total.`,
          action: 'Saisissez la quantité et le prix unitaire, ou à défaut le montant total de la ligne.',
        });
      }
      if (unitPriceDzd === null && manualLineTotalDzd === null) {
        addIssue(sink, {
          severity: 'ERROR',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Unit Price',
          probleme: `La ligne ${rowNumber} n'a ni prix unitaire ni montant total.`,
          action: 'Saisissez le prix unitaire, ou à défaut le montant total de la ligne.',
        });
      }
      if (productName === null) {
        addIssue(sink, {
          severity: 'WARNING',
          sheet: sheet.name,
          row: rowNumber,
          column: 'Product Name (Optional)',
          probleme: `Le nom du produit est vide en ${cellRef(5, rowNumber)}.`,
          action: 'Renseignez le produit pour que cette ligne compte dans le classement des meilleures ventes.',
        });
      }
    }

    activeTxn.lines.push({
      sourceRowNumber: rowNumber,
      lineSequence: activeTxn.lines.length + 1,
      productName,
      brand,
      customDetails,
      partyCompany: partyStr !== null ? partyStr : activeTxn.partyCompany,
      manualBenefitDzd: activeTxn.transactionType === 'SALE' ? benefitVal : null,
      quantity,
      unitPriceDzd,
      manualLineTotalDzd,
    });
  }

  return { transactions, dataRowCount, ignoredRowCount, typedLineTotalCount };
}

export async function parsePaperBookWorkbook(
  file: File,
  today: string = todayIso(),
): Promise<PaperBookWorkbookData> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new WorkbookParseError('Select an .xlsx file created from the Stockiha paper-book template.');
  }
  if (file.size <= 0 || file.size > MAX_XLSX_BYTES) {
    throw new WorkbookParseError('The workbook is empty or exceeds the 20 MB limit.');
  }

  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  const entries = parseCentralDirectory(archiveBytes);
  const workbook = await loadRequiredXml(archiveBytes, entries, 'xl/workbook.xml', 'Workbook metadata');
  const relationships = await loadRequiredXml(archiveBytes, entries, 'xl/_rels/workbook.xml.rels', 'Workbook relationships');
  const styles = await loadRequiredXml(archiveBytes, entries, 'xl/styles.xml', 'Workbook styles');
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(
    sharedEntry ? parseXml(await extractEntry(archiveBytes, sharedEntry), 'Shared strings') : null,
  );
  const dateStyles = parseDateStyleIndexes(styles);

  const targets = new Map<string, string>();
  for (const relationship of elementsByLocalName(relationships, 'Relationship')) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) targets.set(id, normalizeWorkbookTarget(target));
  }

  const sheets = new Map<string, ParsedSheet>();
  for (const sheet of elementsByLocalName(workbook, 'sheet')) {
    const name = sheet.getAttribute('name');
    const relationshipId =
      sheet.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      ) ?? sheet.getAttribute('r:id');
    if (!name || !relationshipId) continue;
    const target = targets.get(relationshipId);
    if (!target) throw new WorkbookParseError(`Worksheet relationship for ${name} is missing.`);
    const xml = await loadRequiredXml(archiveBytes, entries, target, `Worksheet ${name}`);
    sheets.set(name, parseSheet(name, xml, sharedStrings, dateStyles));
  }

  const transactionSheet = sheets.get('Transactions') ?? sheets.get('Historical_Transactions');
  if (!transactionSheet) {
    throw new WorkbookParseError('The paper-book workbook must contain a Transactions sheet.');
  }

  const sink: PaperBookIssueSink = { errors: [], warnings: [], issues: [] };
  const profile = assertPaperBookHeaders(transactionSheet);
  const outcome = parsePaperBookSheet(transactionSheet, sink, profile, today);
  const { transactions } = outcome;

  const contentHash = await computeContentHash(transactions);

  // Counts only — never money. Totals are computed by PostgreSQL from the
  // staged rows, in exact decimal arithmetic.
  let lineCount = 0;
  let salesCount = 0;
  let purchaseCount = 0;
  let expenseCount = 0;
  let salesWithManualBenefitCount = 0;
  let salesWithoutManualBenefitCount = 0;
  let benefitZeroCount = 0;
  let benefitNegativeCount = 0;
  let benefitPositiveCount = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let missingQtyCount = 0;

  transactions.forEach((t) => {
    if (minDate === null || t.transactionDate < minDate) minDate = t.transactionDate;
    if (maxDate === null || t.transactionDate > maxDate) maxDate = t.transactionDate;

    if (t.transactionType === 'SALE') {
      salesCount += 1;
      if (t.manualBenefitDzd === null) {
        salesWithoutManualBenefitCount += 1;
      } else {
        salesWithManualBenefitCount += 1;
        if (isZeroDecimal(t.manualBenefitDzd)) benefitZeroCount += 1;
        else if (isNegativeDecimal(t.manualBenefitDzd)) benefitNegativeCount += 1;
        else benefitPositiveCount += 1;
      }
    } else if (t.transactionType === 'PURCHASE') {
      purchaseCount += 1;
    } else if (t.transactionType === 'EXPENSE') {
      expenseCount += 1;
    }

    t.lines.forEach((l) => {
      lineCount += 1;
      if (l.quantity === null) missingQtyCount += 1;
    });
  });

  const errorCount = sink.issues.filter((issue) => issue.severity === 'ERROR').length;
  const warningCount = sink.issues.filter((issue) => issue.severity === 'WARNING').length;
  const infoCount = sink.issues.filter((issue) => issue.severity === 'INFO').length;

  const summary: PaperBookSummary = {
    dataRowCount: outcome.dataRowCount,
    ignoredRowCount: outcome.ignoredRowCount,
    transactionCount: transactions.length,
    lineCount,
    totalLines: lineCount,
    salesCount,
    purchaseCount,
    expenseCount,
    manualBenefitCount: salesWithManualBenefitCount,
    salesWithManualBenefitCount,
    salesWithoutManualBenefitCount,
    benefitZeroCount,
    benefitNegativeCount,
    benefitPositiveCount,
    minDate,
    maxDate,
    unmatchedProductCount: 0,
    manualOverrideCount: outcome.typedLineTotalCount,
    missingQtyCount,
    errorCount,
    warningCount,
    infoCount,
    isPartial: errorCount > 0,
    contentHash,
  };

  return {
    transactions,
    errors: sink.errors,
    warnings: sink.warnings,
    rowIssues: sink.issues,
    contentHash,
    summary,
  };
}

// Preserve existing generic R0-001 parser
function parseTransactionRows(
  sheet: ParsedSheet,
  errors: HistoricalFinanceImportError[],
): HistoricalFinanceRowInput[] {
  assertHeaders(sheet, HISTORICAL_TRANSACTION_HEADERS);
  const parsed: HistoricalFinanceRowInput[] = [];
  const paperIds = new Set<string>();

  for (const [rowNumber, cells] of [...sheet.rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (rowNumber === 1 || isEmptyDataRow(cells, HISTORICAL_TRANSACTION_HEADERS.length)) continue;
    if (cells.some((c) => c.hasFormula)) {
      throw new WorkbookParseError('Formulas are not allowed in the historical finance template.');
    }
    if (parsed.length >= MAX_TRANSACTION_ROWS) {
      throw new WorkbookParseError(`Historical_Transactions exceeds ${MAX_TRANSACTION_ROWS} rows.`);
    }

    try {
      const paperId = normalizeString(cells[0]?.value);
      if (paperId === '') throw new Error('Paper_ID is required.');
      if (paperIds.has(paperId)) throw new Error('Paper_ID is duplicated inside the workbook.');
      paperIds.add(paperId);

      const transactionType = normalizeString(cells[2]?.value).toUpperCase() as HistoricalTransactionType;
      if (!TRANSACTION_TYPES.has(transactionType)) {
        throw new Error('Transaction_Type is not supported.');
      }
      const paymentStatus = normalizeString(cells[5]?.value).toUpperCase() as HistoricalPaymentStatus;
      if (!PAYMENT_STATUSES.has(paymentStatus)) {
        throw new Error('Payment_Status is not supported.');
      }
      const reviewStatus = normalizeString(cells[6]?.value).toUpperCase() as HistoricalReviewStatus;
      if (!REVIEW_STATUSES.has(reviewStatus)) {
        throw new Error('Review_Status is not supported.');
      }

      const description = normalizeString(cells[3]?.value);
      if (description === '') throw new Error('Description_or_Category is required.');

      parsed.push({
        sourceRowNumber: rowNumber,
        paperId,
        transactionDate: parseIsoDate(cells[1]?.value, 'Transaction_Date'),
        transactionType,
        descriptionOrCategory: description,
        netAmountDzd: parseInteger(cells[4]?.value, 'Net_Amount_DZD', false),
        paymentStatus,
        reviewStatus,
        amountPaidDzd: parseOptionalInteger(cells[7]?.value, 'Amount_Paid_DZD_Optional'),
        expenseCategory: optionalString(cells[8]?.value),
        supplierFournisseur: optionalString(cells[9]?.value),
        customerClient: optionalString(cells[10]?.value),
        notes: optionalString(cells[11]?.value),
      });
    } catch (error) {
      pushError(errors, {
        sheet: sheet.name,
        row: rowNumber,
        message: error instanceof Error ? error.message : 'The row is invalid.',
      });
    }
  }

  return parsed;
}

function parseBalanceRows(
  sheet: ParsedSheet,
  errors: HistoricalFinanceImportError[],
): HistoricalFinanceBalanceInput[] {
  assertHeaders(sheet, HISTORICAL_BALANCE_HEADERS);
  const parsed: HistoricalFinanceBalanceInput[] = [];

  for (const [rowNumber, cells] of [...sheet.rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (rowNumber === 1 || isEmptyDataRow(cells, HISTORICAL_BALANCE_HEADERS.length)) continue;
    if (parsed.length >= MAX_BALANCE_ROWS) {
      throw new WorkbookParseError(`Balances exceeds ${MAX_BALANCE_ROWS} rows.`);
    }

    try {
      const balanceType = normalizeString(cells[1]?.value).toUpperCase() as HistoricalBalanceType;
      if (!BALANCE_TYPES.has(balanceType)) throw new Error('Balance_Type is not supported.');
      const reviewStatus = normalizeString(cells[3]?.value).toUpperCase() as HistoricalReviewStatus;
      if (!REVIEW_STATUSES.has(reviewStatus)) throw new Error('Review_Status is not supported.');

      parsed.push({
        sourceRowNumber: rowNumber,
        balanceDate: parseIsoDate(cells[0]?.value, 'Balance_Date'),
        balanceType,
        amountDzd: parseInteger(cells[2]?.value, 'Amount_DZD', true),
        reviewStatus,
        supplierFournisseur: optionalString(cells[4]?.value),
        customerClient: optionalString(cells[5]?.value),
        notes: optionalString(cells[6]?.value),
      });
    } catch (error) {
      pushError(errors, {
        sheet: sheet.name,
        row: rowNumber,
        message: error instanceof Error ? error.message : 'The row is invalid.',
      });
    }
  }

  return parsed;
}

async function loadRequiredXml(
  archiveBytes: Uint8Array,
  entries: Map<string, ZipEntry>,
  path: string,
  label: string,
): Promise<XMLDocument> {
  const entry = entries.get(path);
  if (!entry) throw new WorkbookParseError(`${label} is missing from the workbook.`);
  return parseXml(await extractEntry(archiveBytes, entry), label);
}

export async function parseHistoricalFinanceWorkbook(
  file: File,
): Promise<HistoricalFinanceWorkbookData> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new WorkbookParseError('Select an .xlsx file created from the Stockiha template.');
  }
  if (file.size <= 0 || file.size > MAX_XLSX_BYTES) {
    throw new WorkbookParseError('The workbook is empty or exceeds the 20 MB limit.');
  }

  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  const entries = parseCentralDirectory(archiveBytes);
  const workbook = await loadRequiredXml(
    archiveBytes,
    entries,
    'xl/workbook.xml',
    'Workbook metadata',
  );
  const relationships = await loadRequiredXml(
    archiveBytes,
    entries,
    'xl/_rels/workbook.xml.rels',
    'Workbook relationships',
  );
  const styles = await loadRequiredXml(archiveBytes, entries, 'xl/styles.xml', 'Workbook styles');
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(
    sharedEntry ? parseXml(await extractEntry(archiveBytes, sharedEntry), 'Shared strings') : null,
  );
  const dateStyles = parseDateStyleIndexes(styles);

  const targets = new Map<string, string>();
  for (const relationship of elementsByLocalName(relationships, 'Relationship')) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) targets.set(id, normalizeWorkbookTarget(target));
  }

  const sheets = new Map<string, ParsedSheet>();
  for (const sheet of elementsByLocalName(workbook, 'sheet')) {
    const name = sheet.getAttribute('name');
    const relationshipId =
      sheet.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      ) ?? sheet.getAttribute('r:id');
    if (!name || !relationshipId) continue;
    const target = targets.get(relationshipId);
    if (!target) throw new WorkbookParseError(`Worksheet relationship for ${name} is missing.`);
    const xml = await loadRequiredXml(archiveBytes, entries, target, `Worksheet ${name}`);
    sheets.set(name, parseSheet(name, xml, sharedStrings, dateStyles));
  }

  const transactionSheet = sheets.get('Historical_Transactions');
  const balanceSheet = sheets.get('Balances');
  if (!transactionSheet || !balanceSheet) {
    throw new WorkbookParseError(
      'The workbook must contain Historical_Transactions and Balances sheets.',
    );
  }

  const errors: HistoricalFinanceImportError[] = [];
  const rows = parseTransactionRows(transactionSheet, errors);
  const balances = parseBalanceRows(balanceSheet, errors);

  if (errors.length >= MAX_REPORTED_ERRORS) {
    errors.push({
      sheet: 'Workbook',
      row: 0,
      message: 'Additional row errors were omitted. Correct the first 100 errors and try again.',
    });
  }

  return { rows, balances, errors };
}
