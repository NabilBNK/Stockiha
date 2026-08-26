/**
 * Deterministic one-shot fix for the two known-bad date cells in the frozen
 * customer test workbook (see Stockiha_TEST_DATASET_expected_results.md,
 * "Deliberate defects" #1 and #2):
 *   - row 6  column B: text "15/052025" (malformed, missing separator) -> 15/05/2025
 *   - row 83 column B: numeric date serial for 2026-09-08 (future-dated) -> 08/09/2025
 *
 * Every staging step in every future task should read
 * Stockiha_Historical_TEST_DATASET_CORRECTED.xlsx directly instead of
 * re-deriving this patch by hand (it has now been done manually at least 3
 * times across separate WS-G/WS-I sessions).
 *
 * Uses fflate (already a project dependency) to unzip/rezip the workbook
 * with explicit, controlled entry names, so entry paths stay forward-slash
 * ("xl/worksheets/sheet1.xml", never "xl\worksheets\sheet1.xml") the way the
 * app's own xlsxParser.ts requires. Rebuilding the archive with a
 * Windows-native tool such as PowerShell's Compress-Archive instead has
 * previously produced backslash entry names that the parser rejects.
 *
 * Run with:  node --experimental-strip-types docs/test-data/fix-fixture-dates.ts
 * (Node 22.23.1, the version this repo develops against, supports this flag
 * natively; the script uses no TypeScript syntax beyond type annotations.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const DATA_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(DATA_DIR, 'Stockiha_Historical_TEST_DATASET.xlsx');
const OUTPUT_PATH = join(DATA_DIR, 'Stockiha_Historical_TEST_DATASET_CORRECTED.xlsx');
const SHEET_ENTRY = 'xl/worksheets/sheet1.xml';

interface CellFix {
  readonly label: string;
  readonly find: string;
  readonly replace: string;
}

// Values verified directly against the shipped fixture and against Excel's
// day-count epoch (days since 1899-12-30, matching xlsxParser.ts's own
// excelSerialToIsoDate): serial 45792 = 2025-05-15, serial 45908 = 2025-09-08.
const CELL_FIXES: readonly CellFix[] = [
  {
    label: 'row 6 (B6): malformed date text "15/052025" -> 15/05/2025',
    find: '<c r="B6" s="13" t="s"><v>20</v></c>',
    replace: '<c r="B6" s="12"><v>45792</v></c>',
  },
  {
    label: 'row 83 (B83): future-dated 2026-09-08 -> 2025-09-08',
    find: '<c r="B83" s="12"><v>46273.0</v></c>',
    replace: '<c r="B83" s="12"><v>45908</v></c>',
  },
];

function main(): void {
  const sourceBytes = new Uint8Array(readFileSync(SOURCE_PATH));
  const entries = unzipSync(sourceBytes);

  const sheetBytes = entries[SHEET_ENTRY];
  if (!sheetBytes) {
    throw new Error(`Expected entry "${SHEET_ENTRY}" was not found in the workbook archive.`);
  }

  let sheetXml = strFromU8(sheetBytes);

  for (const fix of CELL_FIXES) {
    if (!sheetXml.includes(fix.find)) {
      throw new Error(
        `Fixture no longer matches the expected pre-fix content for: ${fix.label}\n` +
          `Expected to find: ${fix.find}\n` +
          'The source fixture may have changed — re-derive the fix before proceeding.',
      );
    }
    sheetXml = sheetXml.replace(fix.find, fix.replace);
  }

  entries[SHEET_ENTRY] = strToU8(sheetXml);

  const outputBytes = zipSync(entries, { level: 6 });
  writeFileSync(OUTPUT_PATH, outputBytes);

  console.log(`Wrote corrected workbook: ${OUTPUT_PATH}`);
  for (const fix of CELL_FIXES) {
    console.log(`  - ${fix.label}`);
  }
}

main();
