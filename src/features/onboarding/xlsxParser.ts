import type {
  HistoricalBalanceType,
  HistoricalFinanceBalanceInput,
  HistoricalFinanceRowInput,
  HistoricalPaymentStatus,
  HistoricalReviewStatus,
  HistoricalTransactionType,
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
  rows: Map<number, CellValue[]>;
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

  const stream = new Blob([bytes]).stream().pipeThrough(
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

function readCellValue(
  cell: Element,
  sharedStrings: string[],
  dateStyles: Set<number>,
): CellValue {
  if (elementsByLocalName(cell, 'f').length > 0) {
    throw new WorkbookParseError('Formulas are not allowed in the historical import workbook.');
  }

  const type = cell.getAttribute('t') ?? '';
  const valueNode = elementsByLocalName(cell, 'v')[0];
  const raw = valueNode?.textContent ?? '';
  if (raw === '' && type !== 'inlineStr') return null;

  if (type === 'inlineStr') {
    return elementsByLocalName(cell, 't')
      .map((text) => text.textContent ?? '')
      .join('');
  }
  if (type === 's') {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      throw new WorkbookParseError('The workbook contains an invalid shared-string reference.');
    }
    return sharedStrings[index];
  }
  if (type === 'str') return raw;
  if (type === 'b') return raw === '1';
  if (type === 'e') throw new WorkbookParseError('The workbook contains an Excel error cell.');
  if (type === 'd') return raw.slice(0, 10);

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return raw;
  const styleIndex = Number(cell.getAttribute('s') ?? '0');
  return dateStyles.has(styleIndex) ? excelSerialToIsoDate(numeric) : numeric;
}

function parseSheet(
  name: string,
  xml: XMLDocument,
  sharedStrings: string[],
  dateStyles: Set<number>,
): ParsedSheet {
  const rows = new Map<number, CellValue[]>();
  for (const rowElement of elementsByLocalName(xml, 'row')) {
    const rowNumber = Number(rowElement.getAttribute('r'));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      throw new WorkbookParseError(`${name} contains an invalid row number.`);
    }

    const values: CellValue[] = [];
    for (const cell of Array.from(rowElement.children).filter(
      (child) => child.localName === 'c',
    )) {
      const reference = cell.getAttribute('r');
      if (!reference) throw new WorkbookParseError(`${name} contains an unaddressed cell.`);
      const columnIndex = columnIndexFromReference(reference);
      if (columnIndex > 100) {
        throw new WorkbookParseError(`${name} contains data beyond the supported columns.`);
      }
      values[columnIndex] = readCellValue(cell, sharedStrings, dateStyles);
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
    if (normalizeString(actual[index]) !== header) {
      throw new WorkbookParseError(
        `${sheet.name} column ${index + 1} must be named ${header}. Use the official Stockiha template.`,
      );
    }
  });
}

function isEmptyDataRow(values: CellValue[], columnCount: number): boolean {
  for (let index = 0; index < columnCount; index += 1) {
    if (normalizeString(values[index]) !== '') return false;
  }
  return true;
}

function parseTransactionRows(
  sheet: ParsedSheet,
  errors: HistoricalFinanceImportError[],
): HistoricalFinanceRowInput[] {
  assertHeaders(sheet, HISTORICAL_TRANSACTION_HEADERS);
  const parsed: HistoricalFinanceRowInput[] = [];
  const paperIds = new Set<string>();

  for (const [rowNumber, values] of [...sheet.rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (rowNumber === 1 || isEmptyDataRow(values, HISTORICAL_TRANSACTION_HEADERS.length)) continue;
    if (parsed.length >= MAX_TRANSACTION_ROWS) {
      throw new WorkbookParseError(`Historical_Transactions exceeds ${MAX_TRANSACTION_ROWS} rows.`);
    }

    try {
      const paperId = normalizeString(values[0]);
      if (paperId === '') throw new Error('Paper_ID is required.');
      if (paperIds.has(paperId)) throw new Error('Paper_ID is duplicated inside the workbook.');
      paperIds.add(paperId);

      const transactionType = normalizeString(values[2]).toUpperCase() as HistoricalTransactionType;
      if (!TRANSACTION_TYPES.has(transactionType)) {
        throw new Error('Transaction_Type is not supported.');
      }
      const paymentStatus = normalizeString(values[5]).toUpperCase() as HistoricalPaymentStatus;
      if (!PAYMENT_STATUSES.has(paymentStatus)) {
        throw new Error('Payment_Status is not supported.');
      }
      const reviewStatus = normalizeString(values[6]).toUpperCase() as HistoricalReviewStatus;
      if (!REVIEW_STATUSES.has(reviewStatus)) {
        throw new Error('Review_Status is not supported.');
      }

      const description = normalizeString(values[3]);
      if (description === '') throw new Error('Description_or_Category is required.');

      parsed.push({
        sourceRowNumber: rowNumber,
        paperId,
        transactionDate: parseIsoDate(values[1], 'Transaction_Date'),
        transactionType,
        descriptionOrCategory: description,
        netAmountDzd: parseInteger(values[4], 'Net_Amount_DZD', false),
        paymentStatus,
        reviewStatus,
        amountPaidDzd: parseOptionalInteger(values[7], 'Amount_Paid_DZD_Optional'),
        expenseCategory: optionalString(values[8]),
        supplierFournisseur: optionalString(values[9]),
        customerClient: optionalString(values[10]),
        notes: optionalString(values[11]),
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

  for (const [rowNumber, values] of [...sheet.rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (rowNumber === 1 || isEmptyDataRow(values, HISTORICAL_BALANCE_HEADERS.length)) continue;
    if (parsed.length >= MAX_BALANCE_ROWS) {
      throw new WorkbookParseError(`Balances exceeds ${MAX_BALANCE_ROWS} rows.`);
    }

    try {
      const balanceType = normalizeString(values[1]).toUpperCase() as HistoricalBalanceType;
      if (!BALANCE_TYPES.has(balanceType)) throw new Error('Balance_Type is not supported.');
      const reviewStatus = normalizeString(values[3]).toUpperCase() as HistoricalReviewStatus;
      if (!REVIEW_STATUSES.has(reviewStatus)) throw new Error('Review_Status is not supported.');

      parsed.push({
        sourceRowNumber: rowNumber,
        balanceDate: parseIsoDate(values[0], 'Balance_Date'),
        balanceType,
        amountDzd: parseInteger(values[2], 'Amount_DZD', true),
        reviewStatus,
        supplierFournisseur: optionalString(values[4]),
        customerClient: optionalString(values[5]),
        notes: optionalString(values[6]),
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
