# Stockiha — WS-O Complete Manual Test Guide (Step-by-Step)

**Target Build Version:** `[ version = WS-O-6.2 ]`  
**Target Environment:** Windows Desktop (Tauri v2, WebView2, PostgreSQL 18.x)  
**Scope:** WS-O Workstream (Buy and Sell by the Box — Sub-plans O-1 through O-7)  
**Authoritative Specification:** `Plans and tasks/WS-O-boxes-and-pieces-spec.md`

---

## Table of Contents
1. [Pre-Flight & Version Verification](#1-pre-flight--version-verification)
2. [Phase 1: Catalogue Setup — 3-Way Unit Classification (O-7)](#2-phase-1-catalogue-setup--3-way-unit-classification-o-7)
3. [Phase 2: Product & Pack Configuration (O-1, O-2, O-7)](#3-phase-2-product--pack-configuration-o-1-o-2-o-7)
4. [Phase 3: Purchasing & Stock Receipts by the Box (O-3)](#4-phase-3-purchasing--stock-receipts-by-the-box-o-3)
5. [Phase 4: Stock Adjustments with Packs (O-5)](#5-phase-4-stock-adjustments-with-packs-o-5)
6. [Phase 5: Inventory Display Everywhere (O-5)](#6-phase-5-inventory-display-everywhere-o-5)
7. [Phase 6: POS Till Selling by the Box (O-4)](#7-phase-6-pos-till-selling-by-the-box-o-4)
8. [Phase 7: Multi-Language & RTL Verification (O-6)](#8-phase-7-multi-language--rtl-verification-o-6)
9. [Phase 8: Startup & Database Migration Resilience](#9-phase-8-startup--database-migration-resilience)
10. [Comprehensive Verification Results Checklist](#10-comprehensive-verification-results-checklist)

---

## 1. Pre-Flight & Version Verification

### Objective
Ensure the application is running the correct build and connected to the active database.

### Steps
1. Launch Stockiha on Windows using `.\run.bat` or inspect the active development window.
2. Sign in as Administrator if not already logged in.
3. Look at the bottom-right corner of the **Dashboard** screen and the **Setup / Login** screens.
4. **Expected Result:**
   - The version marker displays exactly: `[ version = WS-O-6.2 ]`.

---

## 2. Phase 1: Catalogue Setup — 3-Way Unit Classification (O-7)

### Objective
Verify that units are strictly categorized into three distinct kinds, preventing logical confusion between atomic measurement units and packaging containers.

### Step 1.1: Navigate to Catalogue Setup
1. In the sidebar, click **Catalogue Setup** (`/catalogue-setup`).
2. Click the **Units / Unités / الوحدات** tab.
3. Observe the "Add Unit" form: it offers three distinct radio options:
   - **Base Unit** (Unité de base / وحدة أساسية)
   - **Pre-configured Pack Unit** (Conditionnement préconfiguré / تعبئة محددة مسبقاً)
   - **Flexible Pack Unit** (Conditionnement flexible / تعبئة مرنة)

### Step 1.2: Create an Atomic Base Unit
1. Select **Base Unit**:
   - **Name:** `Piece` (or `Pièce` / `قطعة`)
   - Notice that the "Target Base Unit" and "Holds (Factor)" fields are completely hidden.
   - Leave "Allow decimal quantities" checked or unchecked as appropriate.
2. Click **Create Unit**.
3. **Expected Result:**
   - Unit is created. In the table, the unit has a clean **Base Unit** badge.

### Step 1.3: Create a Pre-Configured Pack Unit
1. Select **Pre-configured Pack Unit**:
   - **Name:** `Carton 50`
   - Notice that the **Target Base Unit** dropdown appears, listing **only** atomic base units (e.g. `Piece`, `Kg`). Pack units do not appear.
   - **Target Base Unit:** Select `Piece`.
   - **Holds (Factor):** Enter `50`.
   - Sentence preview shows: `👉 1 Carton 50 = 50 Piece`.
2. Click **Create Unit**.
3. **Expected Result:**
   - Unit is created.
   - In the table, the unit displays a badge: **`Pack: 50 Piece`**.
   - Products using this unit will have their holds factor locked to 50.

### Step 1.4: Create a Flexible Pack Unit
1. Select **Flexible Pack Unit**:
   - **Name:** `Box` (or `Generic Carton` / `صندوق`)
   - Notice that neither Target Base Unit nor Factor is required (the quantity will be defined per product).
2. Click **Create Unit**.
3. **Expected Result:**
   - Unit is created.
   - In the table, the unit displays a badge: **`Flexible Pack`**.

### Step 1.5: Edit & Kind Switching Verification
1. Click **Edit** on `Carton 50`.
2. Verify that the radio selection is locked to Pre-configured Pack, preserving data integrity.
3. Verify that you cannot save a factor `<= 1`.

---

## 3. Phase 2: Product & Pack Configuration (O-1, O-2, O-7)

### Objective
Verify that products can **only** have atomic base units, and that packs strictly enforce container multiples (`factor > 1`) without allowing inverted relationships.

### Step 2.1: Product Creation Strict Base Unit Check
1. Navigate to **Products / Catalog** (`/catalog`).
2. Click **+ Add Product** (`+ Nouveau produit`).
3. In the creation form, open the **Unit** dropdown:
   - **Expected:** Only atomic base units appear (`Piece`, `Kg`, `Liter`).
   - **Crucial:** Pack units (`Carton 50`, `Box`) **never** appear in the product base unit dropdown.

### Step 2.2: Quick Box Creation during Product Create
1. Fill product fields:
   - **Name:** `Pillow Luxury`
   - **Unit:** `Piece`
   - **Price:** `1,250.00 DZD`
2. Expand the **Sold by the box (optional)** section:
   - Open the Box Unit dropdown:
     - **Expected:** Shows `Carton 50` (pre-configured for Piece) and `Box` (flexible).
     - Does **not** show `Piece` or packs belonging to `Kg`.
   - Select `Carton 50`:
     - **Expected:** The Holds input automatically fills `50` and is read-only.
     - Sentence preview shows: `👉 1 Carton 50 = 50 Piece`.
   - Enter Box Price: `60,000.00 DZD`.
3. Click **Create Product**.
4. **Expected Result:**
   - Product is created with base unit `Piece` and a main pack `Carton 50` holding 50 pieces.

### Step 2.3: Pack Manager Inside Product Detail
1. Open the created product detail panel.
2. In the **Packs** section, observe the pack row:
   - Unit: `Carton 50`
   - Holds: `50 Piece` (Holds field is locked because it is pre-configured).
   - Price: `60,000.00 DZD`
   - Per-piece rate: `= 1,200.00 per Piece`
   - Main pack indicator: Star / `Main` badge.

### Step 2.4: Add a Flexible Pack
1. Click **+ Add Pack**:
2. In the modal:
   - Select unit: `Box` (Flexible Pack).
   - Notice the Holds input is editable. Enter `12`.
   - Sentence preview shows: `👉 1 Box = 12 Piece`.
   - Suggested max price prompt appears: `💡 Suggested max: 15,000.00 (12 Piece × 1,250.00)`.
   - Click the suggested price link: Price input populates with `15,000.00`.
   - Enter dedicated barcode: `6130009990011`.
3. Click **Save**.
4. **Expected Result:**
   - Pack saves cleanly. Both `Carton 50` and `Box (×12)` are listed in the table.
   - Legacy "Smaller Units" list does **not** exist anywhere.

### Step 2.5: Logical Bug Prevention & Negative Testing
1. Click **+ Add Pack** again:
   - Check the Unit dropdown:
     - **Verify:** `Piece` is **not** in the dropdown. (A product cannot sell its own base unit as a pack).
     - **Verify:** Packs already assigned (`Carton 50`, `Box`) are **not** offered.
   - Enter factor `1`:
     - **Expected:** Validation error *"A pack must hold more than 1 base unit"*.
   - Enter factor `0` or negative:
     - **Expected:** Validation error.
   - Enter duplicate barcode already assigned to another product:
     - **Expected:** Pre-check error *"This barcode is already used by [Product Name]"*.

### Step 2.6: Replicate Packs to Sibling Variants
1. On a product with variants (e.g. Red, Blue):
   - In the pack row, click **Apply to other variants**.
   - Filter and select target variants.
   - Click **Apply**.
2. **Expected Result:**
   - Target variants now have the pack configured with price and factor, but barcodes remain unique.

---

## 4. Phase 3: Purchasing & Stock Receipts by the Box (O-3)

### Objective
Verify receiving inventory in packs with optional extra pieces, where extra pieces are costed at the carton rate and added to base stock and WAC.

### Step 3.1: Open Stock Receipt
1. Navigate to **Stock Receipts / Direct Purchase** (`/purchases/receipts`).
2. Select warehouse (e.g. *Main Warehouse*), supplier, and invoice reference.

### Step 3.2: Add Pack Line with Extra Pieces
1. Select *Pillow Luxury*.
2. **Expected:** The unit dropdown automatically defaults to the main pack: **`Carton 50 (×50)`**.
3. Set **Cartons Received:** `2`.
4. Set **Extra Pieces:** `10`.
5. Set **Unit Cost per Carton:** `50,000.00 DZD`.
6. Observe calculated values:
   - Total base units received: `(2 × 50) + 10 = 110 Pieces`.
   - Cost rate for extra pieces: `50,000.00 ÷ 50 = 1,000.00 DZD / piece`.
   - Line subtotal: `(2 × 50,000.00) + (10 × 1,000.00) = 110,000.00 DZD`.
7. **Expected Result:**
   - Line displays `2 Carton 50 + 10 Piece` at total `110,000.00 DZD`.

### Step 3.3: Confirm & Post Purchase
1. Click **Confirm Receipt / Réceptionner**.
2. **Expected Result:**
   - Transaction posts atomically.
   - An official receipt document number is assigned.
   - Stored stock increases by exactly **110 Pieces**.
   - Warehouse WAC is updated based on `1,000.00 DZD / piece`.

---

## 5. Phase 4: Stock Adjustments with Packs (O-5)

### Objective
Verify that inventory adjustments support pack entry and compute base equivalents in real time.

### Steps
1. Navigate to **Inventory Corrections / Stock Adjustments** (`/inventory/adjustments`).
2. Select *Pillow Luxury*.
3. **Expected:** Unit selector defaults to **`Carton 50`**.
4. In quantity, enter `1`.
5. **Expected Result:**
   - Indicator below input shows: **`= 50 Piece`** (or `= 50 Unit` / `= 50 قطعة`).
6. Change unit to `Box` (holds 12):
   - In quantity, enter `3`.
   - Indicator updates to: **`= 36 Piece`**.
7. Cancel or post the adjustment as desired.

---

## 6. Phase 5: Inventory Display Everywhere (O-5)

### Objective
Ensure on-hand inventory for products with a main pack is consistently rendered in decomposed pack format across all screens.

### Step 5.1: Products / Catalog Table
1. Navigate to **Products / Catalog** (`/catalog`).
2. Locate *Pillow Luxury* (holding 110 pieces).
3. **Expected Result:**
   - Stock column displays: **`2 Carton 50 + 10 Piece`**.
   - Hovering over the quantity shows tooltip: **`= 110 Piece`**.

### Step 5.2: Inventory Screen (`/inventory`)
1. Navigate to **Inventory**.
2. **Expected Result:**
   - Stock on-hand column displays `2 Carton 50 + 10 Piece`.
   - Tooltip `= 110 Piece` on hover.

### Step 5.3: Global Item Search (`Ctrl+K`)
1. Press `Ctrl+K`.
2. Type `Pillow`.
3. **Expected Result:**
   - Result item preview displays available stock as `2 Carton 50 + 10 Piece`.

### Step 5.4: Stock Reports
1. Navigate to **Reports → Stock Valuation / Low Stock**.
2. **Expected Result:**
   - On-screen report tables display the decomposed pack format with hover tooltip.

---

## 7. Phase 6: POS Till Selling by the Box (O-4)

### Objective
Verify point-of-sale checkout: default pack selection, scanning pack barcodes, mixed quantities, custom price overrides with below-cost warnings, and thermal receipts.

### Step 6.1: Default Unit in POS Cart
1. Navigate to **Point of Sale** (`/pos`).
2. Ensure an active cash session is open.
3. Click the *Pillow Luxury* product card.
4. **Expected Result:**
   - Added to cart defaulting to **1 Carton 50** at `60,000.00 DZD`.
   - Total = `60,000.00 DZD`.

### Step 6.2: Scan Box Barcode
1. In the barcode search input, scan or enter the Box barcode: `6130009990011`.
2. Press Enter.
3. **Expected Result:**
   - Adds a line for **1 Box** (holding 12 pieces) at `15,000.00 DZD`.

### Step 6.3: Sell Mixed Quantity (Cartons + Extra Pieces)
1. On the `Box` line (holds 12 pieces):
   - Quantity of boxes: `1`.
   - In the **Extra Pieces** field, enter `4`.
2. Observe calculation:
   - 1 Box = `15,000.00 DZD`.
   - Extra piece rate = `15,000.00 ÷ 12 = 1,250.00 DZD`.
   - 4 Extra pieces = `4 × 1,250.00 = 5,000.00 DZD`.
   - Total line price = `15,000.00 + 5,000.00 = 20,000.00 DZD`.
3. **Expected Result:**
   - Line description: **`= 16 Piece · 4 Piece at 1,250.00 (Box rate)`**.
   - Subtotal = **`20,000.00 DZD`**.

### Step 6.4: Extra Piece Carry-Over (Overflow)
1. On the `Box` line, click `+` on extra pieces until it reaches 12:
2. **Expected Result:**
   - At 12 pieces, the line carries over to **`2 Box + 0 Piece`**.

### Step 6.5: Below-Cost Price Override
1. On a `Box` line, click the price edit icon.
2. Enter `10,000.00 DZD` (below cost of `12,000.00 DZD`).
3. **Expected Result:**
   - Amber warning appears: **`Below cost / Sous le coût / أقل من التكلفة`**.
   - An indicator badge **`edited / modifié / معدّل`** appears.
   - **Crucial:** Sale checkout is **NOT** blocked (owner ruling R5).

### Step 6.6: Checkout & Receipt Printing
1. Click **Pay Cash**.
2. Enter received payment and confirm checkout.
3. **Expected Result:**
   - Sale posts atomically.
   - Inventory decrements accurately in base units.
   - Thermal receipt / print preview shows:
     - Pack lines with pack name, holds, and extra pieces clearly detailed.

### Step 6.7: Void Sale & Stock Restoration
1. Open the cash session sales drawer.
2. Select the sale and click **Void Sale**.
3. **Expected Result:**
   - Void slip prints with pack details and void stamp.
   - All pieces are restored to inventory stock on-hand.

---

## 8. Phase 7: Multi-Language & RTL Verification (O-6)

### Objective
Verify that packaging terms are cleanly translated without missing keys, placeholder corruption, or layout clipping in French and Arabic.

### Step 7.1: French (`fr`)
1. Switch language to **Français**.
2. Navigate to Catalogue Setup, Products, and POS.
3. **Expected Terms:**
   - Base Unit: `Unité de base`
   - Pre-configured Pack: `Conditionnement préconfiguré`
   - Flexible Pack: `Conditionnement flexible`
   - Pack / Packs: `Conditionnement` / `Conditionnements`
   - Main Pack: `Conditionnement principal`
   - Holds {n} {base}: `Contient {n} {base}`
   - Extra {base}: `{base} en plus`
   - Below Cost: `Sous le coût`
   - Edited: `modifié`
   - Buy Only: `Non vendu (achat uniquement)`

### Step 7.2: Arabic (`ar`) & RTL Layout
1. Switch language to **العربية**.
2. **Expected Terms & Layout:**
   - Entire application switches to **Right-to-Left (RTL)** layout.
   - Numbers and prices format cleanly.
   - Terms:
     - Base Unit: `وحدة أساسية`
     - Pre-configured Pack: `تعبئة محددة مسبقاً`
     - Flexible Pack: `تعبئة مرنة`
     - Pack / Packs: `تعبئة / تعبئات`
     - Main Pack: `التعبئة الرئيسية`
     - Holds: `يحتوي على {n} {base}`
     - Extra pieces: `{base} إضافية`
     - Below Cost: `أقل من التكلفة`
     - Edited: `معدّل`
     - Buy Only: `غير مباع (للشراء فقط)`

---

## 9. Phase 8: Startup & Database Migration Resilience

### Objective
Verify that launching the application or adding migrations is completely self-healing.

### Step 8.1: Launch via `run.bat`
1. Close any running Stockiha window.
2. Double-click `run.bat` or run:
   ```cmd
   .\run.bat
   ```
3. **Expected Output in Console:**
   - `[1/5] Ensuring PostgreSQL is accepting connections on port 5433...` -> `[OK]`
   - `[2/5] Running SQLx migrations...` -> `Total migrations applied: 170` -> `Database migrations: PASS`
   - `[3/5] Checking database credentials and building URL...` -> `[OK] Credentials loaded.`
   - `[4/5] Compiling Stockiha...` -> Clean compilation.
   - `[5/5] Launching Tauri dev window...`
4. **Expected Result:**
   - Stockiha opens directly to the Dashboard or Login screen with **zero** "Database needs an update" errors.

### Step 8.2: Dynamic Retry Verification
1. If the database is ever behind:
   - The app displays the informative "Database needs an update" card.
   - Applying migrations via `run-sqlx-migrations.ps1` and clicking **Retry** immediately succeeds without restarting the app (due to non-caching of mismatch states).

---

## 10. Comprehensive Verification Results Checklist

| Area | Checkpoint | Status | Notes |
|---|---|---|---|
| **Version** | `[ version = WS-O-6.2 ]` on dashboard & setup | [ ] Pass | |
| **Catalogue Setup** | 3-way unit kinds (Base, Pre-configured, Flexible) | [ ] Pass | |
| **Catalogue Setup** | Pre-configured pack locks holds factor across products | [ ] Pass | |
| **Catalog** | Product base unit strictly allows atomic units only | [ ] Pass | |
| **Catalog** | Pack dropdown excludes base units & incompatible packs | [ ] Pass | |
| **Catalog** | Pack holds factor strictly `> 1` (integers for whole base units) | [ ] Pass | |
| **Catalog** | Quick box creation during product create works | [ ] Pass | |
| **Catalog** | Replicate packs to sibling variants works | [ ] Pass | |
| **Purchasing** | Default unit is main pack in stock receipt | [ ] Pass | |
| **Purchasing** | Extra pieces costed at carton rate | [ ] Pass | |
| **Purchasing** | Stored stock & WAC update accurately in base units | [ ] Pass | |
| **Adjustments** | Adjustment unit defaults to main pack with base equivalent | [ ] Pass | |
| **Display** | Products list shows `2 Carton 50 + 10 Piece` + tooltip | [ ] Pass | |
| **Display** | Inventory screen shows `X Pack + Y Unit` | [ ] Pass | |
| **Display** | Item search modal (`Ctrl+K`) shows pack quantities | [ ] Pass | |
| **POS Till** | Auto-defaults to main pack upon tile click | [ ] Pass | |
| **POS Till** | Scanning box barcode increments pack quantity | [ ] Pass | |
| **POS Till** | Mixed line: carton + extra pieces at carton rate | [ ] Pass | |
| **POS Till** | Extra pieces overflow into cartons automatically | [ ] Pass | |
| **POS Till** | Below-cost warning does NOT block sale checkout | [ ] Pass | |
| **Receipts** | Thermal receipt prints carton & extra piece lines | [ ] Pass | |
| **Void** | Void restores stock in base units; void slip prints | [ ] Pass | |
| **French** | Accurate French copy (`Conditionnement`, `Sous le coût`) | [ ] Pass | |
| **Arabic** | Clean RTL alignment, no clipping, correct terminology | [ ] Pass | |
| **Launcher** | `run.bat` automatically migrates database before launch | [ ] Pass | |
| **Retry** | Clicking Retry re-checks live database and proceeds | [ ] Pass | |
