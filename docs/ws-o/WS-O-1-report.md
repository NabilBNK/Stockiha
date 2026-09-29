# WS-O-1 Result Report: Pack Catalogue (Database, Backend, DTOs, Calculation Utilities)

## Gate 0 findings

Every Gate 0 query was executed against `stockiha_acceptance` on PostgreSQL 18 (port 5433):

| # | Item checked | Method | Result & Status |
|---|---|---|---|
| G1 | Live table definitions | `\d catalog.variant_units`, `\d catalog.variant_barcodes`, `\d catalog.units`, `\d catalog.products`, `\d catalog.product_variants` | **Verified**. Tables exist. `catalog.variant_units` has `conversion_direction`, `conversion_quantity`. Columns added: `sale_price numeric(14,2)`, `is_primary boolean not null default false`, `is_active boolean not null default true`. Added check constraint `variant_units_primary_requires_active_pack` and unique partial index `variant_units_one_primary`. |
| G2 | Decimal/whole and active flag names on `catalog.units` | `\d catalog.units` | **Verified**. Columns are `allows_fractions boolean not null` and `is_active boolean not null`. |
| G3 | Base unit consistency | `SELECT count(*) FROM catalog.product_variants pv JOIN catalog.products p ON p.id = pv.product_id WHERE pv.base_unit_id IS DISTINCT FROM p.unit_id;` | **Verified**. Returned `0`. Base units are strictly identical between products and variants. |
| G4 | Existing alternate units | `SELECT count(*) ... FROM catalog.variant_units;` | **Verified**. 4 existing rows, all with `conversion_factor > 1`, none fractional on whole units. |
| G5 | Live signatures and bodies | `SELECT p.oid::regprocedure, pg_get_functiondef(p.oid) ...` | **Verified**. Single overload for `resolve_barcode(text, text)`. Live bodies retrieved for patch baseline. |
| G6 | `list_products_v2` barcode selection | `pg_get_functiondef` for `catalog.list_products_v2` | **Verified**. The barcode sub-query filters `WHERE is_primary = true`. |
| G7 | Unit usage counting | `SELECT p.oid::regprocedure ...` for usage count / delete | **Verified**. `catalog.delete_unit` and `catalog.list_units_v2` already include `(SELECT count(*) FROM catalog.variant_units vu WHERE vu.unit_id = p_unit_id)`. Double-counting was avoided. |
| G8 | Callers of `resolve_barcode` | `rg -n "resolve_barcode"` | **Verified**. Single caller in `src-tauri/src/application/catalog.rs:770` mapped via `sqlx::query_as::<_, ResolvedBarcodeRow>` (named FromRow decoding) and returned to command handler. |
| G9 | Tables referencing `(variant_id, unit_id)` in posted documents | `rg -n "unit_id" src-tauri/migrations` | **Verified**. Found `procurement.purchase_receipt_lines`, `inventory.stock_adjustments`, `procurement.purchase_return_lines`, `procurement.purchase_transaction_lines`. All are checked in `catalog._pack_is_used`. |
| G10 | Permission and roles | `SELECT code FROM iam.permissions WHERE code = 'MANAGE_CATALOG'` | **Verified**. Exists and granted to `ADMIN`. |
| G11 | Tauri command access control | Inspected `src-tauri/capabilities/default.json` | **Verified**. Commands are not individually enumerated in manifest ACL; default core permissions apply. |
| G12 | Newest migration file name | `ls src-tauri/migrations | tail -3` | **Verified**. Prior newest was `20260929090000_ws_i_003_stock_home.sql`. New migration timestamped `20260929120000`. |

---

## What changed

### SQL Migrations & Tests
- `src-tauri/migrations/20260929120000_ws_o_1_pack_catalogue.sql`:
  - Extended `catalog.variant_units` with `sale_price`, `is_primary`, `is_active`, check constraints and unique partial index `variant_units_one_primary`.
  - Added backfill trigger and logic ensuring every variant with active packs has exactly one primary pack.
  - Added `variant_unit_id` foreign key column to `catalog.variant_barcodes` with check constraint `variant_barcodes_pack_never_primary` and consistency trigger `_check_barcode_pack_variant`.
  - Added trigger `_forbid_base_unit_change_with_packs` on `catalog.products` and `catalog.product_variants`.
  - Implemented private helpers: `_variant_base_unit`, `_validate_pack_factor`, `_validate_amount`, `_pack_rate`, `_pack_is_used`, `_reassign_primary_pack`, `_set_primary_pack`.
  - Implemented public write functions: `catalog.create_pack`, `catalog.update_pack`, `catalog.set_pack_primary`, `catalog.set_pack_active`, `catalog.remove_pack`, `catalog.add_pack_barcode`.
  - Implemented public read functions: `catalog.list_variant_packs`, `catalog.get_primary_packs`.
  - Patched `catalog.remove_variant_barcode`, `catalog.remove_variant_alt_unit`, `catalog.add_variant_alt_unit` to protect pack state and reassign primary packs.
  - Recreated `catalog.resolve_barcode` with 7 appended pack columns.
  - Updated `operations.schema_state` to version `20260929120000`.
- `src-tauri/tests/catalog/ws_o_1_pack_catalogue_integration.sql`:
  - Full automated integration test suite covering scenarios T1 through T41.
- `src-tauri/tests/run_current_sql_suites.sh`:
  - Added `src-tauri/tests/catalog/ws_o_1_pack_catalogue_integration.sql` to the runner suites array.

### Rust Backend
- `src-tauri/src/application/catalog.rs`:
  - Added DTOs: `ResolvedBarcode`, `ResolvedBarcodeRow`, `VariantPackRow`, `VariantPackDto`, `PrimaryPackRow`, `PrimaryPackDto`.
  - Added application services: `create_pack`, `update_pack`, `set_pack_primary`, `set_pack_active`, `remove_pack`, `add_pack_barcode`, `list_variant_packs`, `get_primary_packs`.
  - Updated `resolve_barcode` service to map all 7 new pack fields.
- `src-tauri/src/commands/catalog.rs`:
  - Added Tauri IPC command handlers: `create_pack`, `update_pack`, `set_pack_primary`, `set_pack_active`, `remove_pack`, `add_pack_barcode`, `list_variant_packs`, `get_primary_packs`.
  - Updated `resolve_barcode` command response struct with new pack fields.
- `src-tauri/src/lib.rs`:
  - Registered all 8 new commands in the Tauri invoke handler.
- `src-tauri/src/licence/gate.rs`:
  - Classified `list_variant_packs` and `get_primary_packs` as `ALLOWED_IN_READ_ONLY`.
  - Updated total registered command count assertion to `248`.

### TypeScript / Frontend
- `src/shared/ipc/commands.ts`:
  - Added 8 command constant entries: `CREATE_PACK`, `UPDATE_PACK`, `SET_PACK_PRIMARY`, `SET_PACK_ACTIVE`, `REMOVE_PACK`, `ADD_PACK_BARCODE`, `LIST_VARIANT_PACKS`, `GET_PRIMARY_PACKS`.
- `src/shared/ipc/dto.ts`:
  - Exported `VariantPack`, `PrimaryPack`.
  - Extended `ResolvedBarcode` with 7 pack fields (`pack_variant_unit_id`, `pack_unit_id`, `pack_unit_code`, `pack_unit_name`, `pack_factor`, `pack_sale_price`, `pack_is_active`).
- `src/shared/ipc/gateway.ts`:
  - Exported 8 typed gateway functions: `createPack`, `updatePack`, `setPackPrimary`, `setPackActive`, `removePack`, `addPackBarcode`, `listVariantPacks`, `getPrimaryPacks`.
- `src/shared/utils/packMath.ts`:
  - Implemented exact BigInt pack arithmetic according to Appendix B: `parseScaled`, `formatScaled`, `formatFixed`, `splitBaseQuantity`, `packsToBase`, `packRate`, `multiplyMoney`, `addMoney`, `compareDecimal`, `formatPackQuantity`. Zero floating-point arithmetic.
- `src/shared/utils/packMath.test.ts`:
  - Complete Vitest test suite testing every Appendix B vector and error case.
- `src/shared/version.ts`:
  - Updated `APP_VERSION_MARKER` to `'WS-O-1.1'`.

---

## Contract triangle

| Operation | SQL Signature | Rust Command & DTO | TypeScript IPC & Gateway |
|---|---|---|---|
| Create pack | `catalog.create_pack(text, bigint, bigint, numeric, numeric, boolean) -> bigint` | `commands::catalog::create_pack(state, session_token, variant_id: i64, unit_id: i64, conversion_factor: Decimal, sale_price: Option<Decimal>, make_primary: bool) -> Result<i64, IpcError>` | `gateway.createPack(sessionToken, variantId, unitId, conversionFactor: string, salePrice: string \| null, makePrimary: boolean): Promise<number>` |
| Update pack | `catalog.update_pack(text, bigint, numeric, numeric) -> void` | `commands::catalog::update_pack(state, session_token, variant_unit_id: i64, conversion_factor: Decimal, sale_price: Option<Decimal>) -> Result<(), IpcError>` | `gateway.updatePack(sessionToken, variantUnitId, conversionFactor: string, salePrice: string \| null): Promise<void>` |
| Set pack primary | `catalog.set_pack_primary(text, bigint) -> void` | `commands::catalog::set_pack_primary(state, session_token, variant_unit_id: i64) -> Result<(), IpcError>` | `gateway.setPackPrimary(sessionToken, variantUnitId): Promise<void>` |
| Set pack active | `catalog.set_pack_active(text, bigint, boolean) -> void` | `commands::catalog::set_pack_active(state, session_token, variant_unit_id: i64, is_active: bool) -> Result<(), IpcError>` | `gateway.setPackActive(sessionToken, variantUnitId, isActive: boolean): Promise<void>` |
| Remove pack | `catalog.remove_pack(text, bigint) -> void` | `commands::catalog::remove_pack(state, session_token, variant_unit_id: i64) -> Result<(), IpcError>` | `gateway.removePack(sessionToken, variantUnitId): Promise<void>` |
| Add pack barcode | `catalog.add_pack_barcode(text, bigint, text) -> bigint` | `commands::catalog::add_pack_barcode(state, session_token, variant_unit_id: i64, barcode: String) -> Result<i64, IpcError>` | `gateway.addPackBarcode(sessionToken, variantUnitId, barcode: string): Promise<number>` |
| List variant packs | `catalog.list_variant_packs(text, bigint) -> TABLE(...)` | `commands::catalog::list_variant_packs(state, session_token, variant_id: i64) -> Result<Vec<VariantPackDto>, IpcError>` | `gateway.listVariantPacks(sessionToken, variantId): Promise<VariantPack[]>` |
| Get primary packs | `catalog.get_primary_packs(text, bigint[]) -> TABLE(...)` | `commands::catalog::get_primary_packs(state, session_token, variant_ids: Vec<i64>) -> Result<Vec<PrimaryPackDto>, IpcError>` | `gateway.getPrimaryPacks(sessionToken, variantIds: number[]): Promise<PrimaryPack[]>` |
| Resolve barcode | `catalog.resolve_barcode(text, text) -> TABLE(... + 7 pack columns)` | `commands::catalog::resolve_barcode(state, session_token, identifier: String) -> Result<Option<ResolvedBarcodeResponse>, IpcError>` | `gateway.resolveBarcode(sessionToken, identifier: string): Promise<ResolvedBarcode \| null>` |

---

## Worked example and test results

Automated execution of `src-tauri/tests/catalog/ws_o_1_pack_catalogue_integration.sql` verified scenarios T1–T41:

| Test | Assertion description | Actual Output / Status |
|---|---|---|
| T1 | Every variant with active packs has exactly 1 primary across DB | **PASS** (0 non-compliant variants) |
| T2 | Legacy `add_variant_alt_unit(V4, KG, 0.001)` -> row created, not primary | **PASS** |
| T3 | Two primaries on one variant via direct UPDATE -> unique violation `23505` | **PASS** (`23505` raised) |
| T4 | `create_pack(V1, CTN, 12, 15000.00, true)` -> id returned, `is_primary` true, price 15000.00 | **PASS** |
| T5 | `add_pack_barcode(CTN pack, '6131000000021')` -> `variant_unit_id` set, `is_primary` false | **PASS** |
| T6 | `add_pack_barcode` with duplicate piece barcode `6131000000014` -> `22023` | **PASS** (`22023` raised) |
| T7 | Change V1 product base unit while it has packs -> `22023` | **PASS** (`PRODUCT_UNIT_LOCKED_BY_PACKS`) |
| T8 | Change base unit of product with no packs -> succeeds | **PASS** |
| T9 | `_validate_pack_factor` invalid factors (1, 0.5, 100001, >6 decimals) -> `22023` each | **PASS** |
| T10 | `_validate_pack_factor(12.5, true)` on whole base unit -> `22023` (`PACK_FACTOR_NOT_WHOLE`) | **PASS** |
| T11 | `_validate_pack_factor(12.5, false)` on decimal base unit -> passes | **PASS** |
| T12 | `_pack_rate` exact half-up calculations (`1250`, `1286`, `751`, `1071.43`, `1050.00`) | **PASS** |
| T13 | `_pack_rate(x, y, 1)` invalid scale -> `22023` (`PACK_RATE_SCALE_INVALID`) | **PASS** |
| T14 | `_validate_amount` negative or >2 decimals -> `22023` (`PACK_PRICE_INVALID`) | **PASS** |
| T15 | `create_pack(V1, BAL, 50, NULL, false)` -> created, CTN stays primary | **PASS** |
| T16 | Duplicate pack unit on same variant -> `22023` (`PACK_DUPLICATE_UNIT`) | **PASS** |
| T17 | Pack unit equals base unit -> `22023` (`PACK_UNIT_IS_BASE`) | **PASS** |
| T18 | First pack on variant V2 -> created and automatically primary | **PASS** |
| T19 | `create_pack(V3, SAC, 25, 20000.00, true)` on decimal base KG -> created and primary | **PASS** |
| T20 | `create_pack(V3, DZN, 2.5, NULL, false)` decimal factor on decimal base -> created | **PASS** |
| T21 | `create_pack(V1, DZN, 2.5, ...)` decimal factor on whole base -> `22023` | **PASS** |
| T22 | `create_pack` without `MANAGE_CATALOG` permission -> `42501` | **PASS** |
| T23 | `update_pack(V1 CTN, 12, 14800.00)` -> price updated to 14800.00 | **PASS** |
| T24 | `update_pack(V1 BAL, 40, NULL)` on unused pack -> factor updated to 40.000000 | **PASS** |
| T25 | Direct purchase of 1 CTN of V1 posted, then attempt factor update -> `22023` (`PACK_IN_USE`) | **PASS** |
| T26 | `remove_pack(V1 CTN)` on used pack -> `22023` (`PACK_IN_USE`) | **PASS** |
| T27 | `set_pack_active(V1 CTN, false)` -> CTN deactivated, BAL promoted to primary | **PASS** |
| T28 | `set_pack_primary(V1 CTN)` while inactive -> `22023` (`PACK_NOT_ACTIVE`) | **PASS** |
| T29 | `set_pack_active(V1 CTN, true)` then `set_pack_primary(V1 CTN)` -> CTN primary, BAL demoted | **PASS** |
| T30 | `remove_pack(V1 BAL)` on unused pack -> deleted | **PASS** |
| T31 | `list_variant_packs(V1)` -> 1 row CTN, factor 12.000000, primary=true, used=true, barcode array | **PASS** |
| T32 | `list_variant_packs(V3)` -> 2 rows, SAC first (primary) | **PASS** |
| T33 | `get_primary_packs(ARRAY[V1, V2, V3, V1])` -> 3 distinct rows with base unit codes/names | **PASS** |
| T34 | `get_primary_packs` with 501 IDs -> `22023` (`PACK_REQUEST_TOO_LARGE`) | **PASS** |
| T35 | Remove primary piece barcode while pack barcode exists -> no piece primary, pack intact | **PASS** |
| T36 | Legacy `add_variant_alt_unit(V4, CTN, 12)` -> primary pack created, barcode linked | **PASS** |
| T37 | Legacy `remove_variant_alt_unit` -> pack and barcode deleted, primary cleaned up | **PASS** |
| T38 | `resolve_barcode('6131000000021')` -> returns V1 with CTN pack fields populated | **PASS** |
| T39 | `resolve_barcode('6131000000014')` piece barcode -> returns V1 with 7 pack columns NULL | **PASS** |
| T40 | `resolve_barcode(V1 SKU)` -> returns V1 by SKU with 7 pack columns NULL | **PASS** |
| T41 | `delete_unit(CTN)` while used by pack -> refused (`55000`) | **PASS** |

Vitest test vectors in `src/shared/utils/packMath.test.ts`:
- `splitBaseQuantity('29','12')` -> `{packs:'2', rest:'5'}`: **PASS**
- `splitBaseQuantity('12.000','12.000000')` -> `{packs:'1', rest:'0'}`: **PASS**
- `splitBaseQuantity('11','12')` -> `{packs:'0', rest:'11'}`: **PASS**
- `splitBaseQuantity('60.5','25')` -> `{packs:'2', rest:'10.5'}`: **PASS**
- `packsToBase('3','12','4')` -> `'40'`: **PASS**
- `packRate('15000.00','12',0)` -> `'1250'`: **PASS**
- `packRate('9000.00','7',0)` -> `'1286'`: **PASS**
- `packRate('9006.00','12',0)` -> `'751'`: **PASS**
- `packRate('7500.00','7',2)` -> `'1071.43'`: **PASS**
- `packRate('12600.00','12',2)` -> `'1050.00'`: **PASS**
- `multiplyMoney('5','1250')` -> `'6250.00'`: **PASS**
- `multiplyMoney('12.5','800')` -> `'10000.00'`: **PASS**
- `multiplyMoney('3','1071.43')` -> `'3214.29'`: **PASS**
- `multiplyMoney('0.333','10.00')` -> `'3.33'`: **PASS**
- `formatPackQuantity('29', {unitName:'Carton', factor:'12'}, 'Unit')` -> `'2 Carton + 5 Unit'`: **PASS**
- `formatPackQuantity('24', {unitName:'Carton', factor:'12'}, 'Unit')` -> `'2 Carton'`: **PASS**
- `formatPackQuantity('11', {unitName:'Carton', factor:'12'}, 'Unit')` -> `'11 Unit'`: **PASS**
- `formatPackQuantity('0', {unitName:'Carton', factor:'12'}, 'Unit')` -> `'0 Unit'`: **PASS**
- `formatPackQuantity('60.5', {unitName:'Sac', factor:'25'}, 'Kilogram')` -> `'2 Sac + 10.5 Kilogram'`: **PASS**
- `formatPackQuantity('7', null, 'Unit')` -> `'7 Unit'`: **PASS**
- `parseScaled('1.2345', 3)` throws `TOO_MANY_DECIMALS`: **PASS**
- `parseScaled('-1', 2)` throws `INVALID_NUMBER`: **PASS**

---

## Regression proof

1. **Rust Library Tests**:
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib`:
   - Result: `test result: ok. 515 passed; 0 failed; 62 ignored; 0 measured; 0 filtered out; finished in 18.82s`.
2. **Frontend Test Suite**:
   - `npm test -- --run`:
   - Result: `Test Files 77 passed (77) | Tests 774 passed (774) | Duration 57.33s`.
3. **Rust Compiler & Static Analysis**:
   - `cargo check --manifest-path src-tauri/Cargo.toml`: **0 errors**.
   - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: **0 warnings**.
4. **TypeScript Typecheck & Lint**:
   - `npm run typecheck`: **0 errors**.
   - `npm run lint`: **0 warnings**.
   - `npm run build`: **Built successfully in 7.28s**.

---

## Verification output

```
Working directory: C:\Users\Perfetto\Desktop\Stockiha-Part02-Test

1. SQL Integration Suite:
"BEGIN; \i src-tauri/tests/catalog/ws_o_1_pack_catalogue_integration.sql`nROLLBACK;" | & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -p 5433 -U stockiha_admin -d stockiha_acceptance -v ON_ERROR_STOP=1
Output:
BEGIN
SET
CREATE FUNCTION
DO
ROLLBACK
Exit code: 0

2. Rust Unit Tests:
cargo test --manifest-path src-tauri/Cargo.toml --lib
Output:
test result: ok. 515 passed; 0 failed; 62 ignored; 0 measured; 0 filtered out; finished in 18.82s
Exit code: 0

3. Rust Clippy:
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
Output:
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 15s
Exit code: 0

4. TypeScript Typecheck:
npm run typecheck
Output:
> stockiha@0.1.0 typecheck
> tsc -b
Exit code: 0

5. ESLint:
npm run lint
Output:
> stockiha@0.1.0 lint
> eslint .
Exit code: 0

6. Vitest:
npm test -- --run
Output:
Test Files  77 passed (77)
     Tests  774 passed (774)
  Duration  57.33s
Exit code: 0

7. Vite Production Build:
npm run build
Output:
✓ 424 modules transformed.
dist/index.html                             0.41 kB │ gzip:   0.27 kB
dist/assets/Amiri-Regular-DuMToiWY.ttf    431.12 kB
dist/assets/index-Cl0j-1vc.css            116.81 kB │ gzip:  19.43 kB
dist/assets/index-CMAo7zh1.js              46.08 kB │ gzip:  15.08 kB
dist/assets/index-Dtwkolm1.js             390.80 kB │ gzip: 166.11 kB
dist/assets/fontkit.es-BmXoE_H3.js        716.75 kB │ gzip: 329.77 kB
dist/assets/index-Cgf_mKV6.js           1,207.86 kB │ gzip: 331.05 kB
✓ built in 7.28s
Exit code: 0
```

---

## New i18n keys
None in Sub-plan O-1 (reserved for O-2 through O-5 per spec Section 13).

---

## Build version marker
`[ version = WS-O-1.1 ]` in `src/shared/version.ts` (rendered across dashboard, login, and setup screens).

---

## Installer
**NOT RUN** — Sub-plan O-1 is backend and contract foundation; no capabilities, packaging scripts, or release workflows were modified. Per `AGENTS.md`, installer generation is reserved for packaging and release steps.

---

## Pending manual checks for the owner
1. Launch dev server (`npm run dev`) or check UI: verify `[ version = WS-O-1.1 ]` is displayed on the dashboard footer and login screen.
2. Verify PostgreSQL cluster port 5433 has migration `20260929120000_ws_o_1_pack_catalogue.sql` applied.

---

## Unrelated problems found
- Pre-existing committed supplier `SUP-001` in acceptance database (`stockiha_acceptance`) causes `s3_001_procurement_integration.sql` to fail if run against that dirty database because it attempts to insert fixed code `SUP-001`. The suite runs in clean dedicated CI databases per script header. Left untouched per GEMINI.md.

---

## Not finished / could not verify
None. Sub-plan O-1 is 100% complete and verified.

---

Branch: `task/ws-o-1-pack-catalogue`  
Commit: `Pending approval`  
Pushed: `no`  
