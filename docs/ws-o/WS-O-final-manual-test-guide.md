# Stockiha — WS-O Complete Manual Test Guide (Step-by-Step)

**Target Build Version:** `[ version = WS-O-6.1 ]`  
**Target Environment:** Windows Desktop (Tauri v2, WebView2, PostgreSQL 18.x)  
**Scope:** WS-O Workstream (Buy and Sell by the Box — Sub-plans O-1 through O-6)  
**Authoritative Specification:** `Plans and tasks/WS-O-boxes-and-pieces-spec.md`

---

## Table of Contents
1. [Pre-Flight & Version Verification](#1-pre-flight--version-verification)
2. [Phase 1: Unit & Pack Configuration in Catalog (O-1 & O-2)](#2-phase-1-unit--pack-configuration-in-catalog-o-1--o-2)
3. [Phase 2: Purchasing & Stock Receipts by the Box (O-3)](#3-phase-2-purchasing--stock-receipts-by-the-box-o-3)
4. [Phase 3: Stock Adjustments with Packs (O-5)](#4-phase-3-stock-adjustments-with-packs-o-5)
5. [Phase 4: Inventory Display Everywhere (O-5)](#5-phase-4-inventory-display-everywhere-o-5)
6. [Phase 5: POS Till Selling by the Box (O-4)](#6-phase-5-pos-till-selling-by-the-box-o-4)
7. [Phase 6: Multi-Language & RTL Verification (O-6)](#7-phase-6-multi-language--rtl-verification-o-6)
8. [Comprehensive Verification Results Checklist](#8-comprehensive-verification-results-checklist)

---

## 1. Pre-Flight & Version Verification

### Objective
Ensure the application is running the correct build and connected to the active database.

### Steps
1. Launch Stockiha on Windows or inspect the active development window.
2. Sign in as Administrator if not already logged in.
3. Look at the bottom-right corner of the **Dashboard** screen and the **Setup / Login** screens.
4. **Expected Result:**
   - The version marker displays exactly: `[ version = WS-O-6.1 ]`.

---

## 2. Phase 1: Unit & Pack Configuration in Catalog (O-1 & O-2)

### Objective
Verify that products can have secondary packaging units (boxes, cartons, bales) defined with custom conversion factors, independent sale prices, and barcodes.

### Step 1.1: Verify Reference Units
1. Navigate to **Catalogue Setup → Units** (`/catalog/units`).
2. Verify that **Carton** exists (Code: `CTN`, allows fractions: `false`).
3. If not present, create it:
   - Name: `Carton`
   - Code: `CTN`
   - Whole numbers only (no decimals).

### Step 1.2: Configure Main Pack on a Product
1. Navigate to **Products / Catalog** (`/catalog` or `/products`).
2. Locate or create a product counted in pieces, e.g. **Pillow** (*Oreiller*), base unit **Piece** (*Pièce* / *Unit*), base price `1,250.00 DZD`.
3. Open the product detail/edit panel by clicking the **Edit** button.
4. Scroll to the **Packs (boxes, cartons, bales) / Conditionnements / التعبئات** section.
5. Click **+ Add Pack** (`+ Ajouter un conditionnement` / `+ إضافة تعبئة`).
6. In the modal:
   - **Unit:** Select `Carton`.
   - **Holds (Factor):** Enter `12`.
   - Notice the suggested price helper shows `= 15,000.00 DZD (12 × 1,250.00)`.
   - **Sale Price:** Enter `15,000.00`.
   - **Main Pack:** Ensure checkbox is checked.
   - **Barcode:** Enter a dedicated box barcode, e.g. `6130009990011`.
7. Click **Save**.
8. **Expected Result:**
   - Pack saves without error.
   - The pack table shows:
     - Unit: `Carton`
     - Factor: `12 Piece`
     - Price: `15,000.00 DZD`
     - Per Unit Rate: `= 1,250.00 per Piece`
     - Status: `Active`
     - Main indicator: Filled star / `Main` badge
     - Barcode: `6130009990011`

### Step 1.3: Add a Buy-Only Pack
1. In the same Packs section, click **+ Add Pack**.
2. Select unit: `Bale` (or `Box`).
3. Set holds / factor: `50`.
4. Leave **Sale Price** completely empty (NULL).
5. Click **Save**.
6. **Expected Result:**
   - Pack is created.
   - The price column displays: **`Not sold (buy only) / Non vendu (achat uniquement) / غير مباع (للشراء فقط)`**.

### Step 1.4: Validation Checks (Negative Testing)
1. Click **+ Add Pack** again:
   - Try to select the base unit `Piece`: **Expected:** Blocked or validation error *"A pack cannot use the base unit"*.
   - Select `Carton` again: **Expected:** Validation error *"This unit is already used by another pack"*.
   - Enter factor `12.5` on this whole-number product: **Expected:** Validation error *"This product is counted in whole units; enter a whole number"*.
   - Enter factor `1`: **Expected:** Validation error *"A pack must hold more than 1 base unit"*.
   - Enter price `15000.555`: **Expected:** Validation error *"Enter a valid price with at most 2 decimal places"*.
   - Enter the product's piece barcode in the box barcode input: **Expected:** Pre-check error *"This barcode is already used by Pillow"*.
2. Close the modal without saving.

### Step 1.5: Replicate Packs to Sibling Variants
1. If the product has multiple variants (e.g. Red, Blue):
   - In the pack row, click the **Apply to other variants** button.
   - In the dialog, select sibling variants and confirm.
2. **Expected Result:**
   - Sibling variants now have the `Carton` pack configured without copying the barcode (preserving barcode uniqueness).

### Step 1.6: Quick Product Creation with Default Box
1. Click **+ Add Product** (`+ Nouveau produit` / `+ منتج جديد`).
2. In the quick-create panel, enter:
   - Name: `Blanket Luxury`
   - SKU: `BLK-LUX`
   - Price: `3,000.00 DZD`
3. Expand **Sold by the box (optional) / Vendu par carton (optionnel) / البيع بالكرتون (اختياري)**:
   - Check the enable checkbox.
   - Unit: `Carton`
   - Holds: `6`
   - Box Price: `17,000.00 DZD`
4. Click **Create Product**.
5. **Expected Result:**
   - Product is created and immediately opened with its `Carton` pack set as main.

---

## 3. Phase 2: Purchasing & Stock Receipts by the Box (O-3)

### Objective
Verify receiving inventory in packs with optional extra pieces, where extra pieces are costed at the carton rate and added to base stock and WAC.

### Step 2.1: Open Stock Receipt
1. Navigate to **Stock Receipts / Direct Purchase** (`/purchases/receipts`).
2. Select your warehouse (e.g. *Main Warehouse*).
3. Select supplier and invoice reference.

### Step 2.2: Add Pack Line with Extra Pieces
1. Select *Pillow*.
2. **Expected:** The unit dropdown automatically defaults to **`Carton (×12)`**.
3. Set **Cartons Received:** `3`.
4. Set **Extra Pieces:** `4`.
5. Set **Unit Cost per Carton:** `12,000.00 DZD`.
6. Observe the calculated values:
   - Total base units received: `3 × 12 + 4 = 40 Pieces`.
   - Cost rate for extra pieces: `12,000.00 ÷ 12 = 1,000.00 DZD / piece`.
   - Line subtotal: `(3 × 12,000.00) + (4 × 1,000.00) = 40,000.00 DZD`.
7. **Expected Result:**
   - Line displays `3 Carton + 4 Piece` at total `40,000.00 DZD`.

### Step 2.3: Confirm & Post Purchase
1. Click **Confirm Receipt / Réceptionner**.
2. **Expected Result:**
   - Transaction posts cleanly and atomically.
   - An official receipt document number is assigned.
   - Stored stock increases by exactly **40 Pieces**.
   - Warehouse WAC is updated based on `40,000.00 DZD` for 40 pieces (`1,000.00 DZD/piece`).

---

## 4. Phase 3: Stock Adjustments with Packs (O-5)

### Objective
Verify that stock adjustment screens assist the operator by defaulting to the main pack and calculating base equivalents.

### Steps
1. Navigate to **Inventory Corrections / Stock Adjustments** (`/inventory/adjustments`).
2. Select *Pillow*.
3. **Expected:** The unit selector automatically defaults to **`Carton`**.
4. In the quantity field, enter `2`.
5. **Expected Result:**
   - Below the input, an indicator displays: **`= 24 Piece`** (or `= 24 Unit` / `= 24 قطعة`).
6. Switch the unit dropdown to **`Piece`**:
   - **Expected:** The indicator updates or clears, showing standard base unit behavior.
7. Cancel or post the adjustment as desired.

---

## 5. Phase 4: Inventory Display Everywhere (O-5)

### Objective
Ensure that on every screen showing inventory on-hand, quantities for products with a main pack are rendered in pack-decomposed format.

### Step 4.1: Products / Catalog Table
1. Navigate to **Products / Catalog** (`/catalog` or `/products`).
2. Locate *Pillow* (currently holding e.g. 29 or 40 pieces).
3. **Expected Result:**
   - If stock is `29`: Displays **`2 Carton + 5 Piece`** (tabular digits).
   - If stock is `40`: Displays **`3 Carton + 4 Piece`**.
   - Hover your mouse over the quantity text:
     - Tooltip displays: **`= 29 Piece`** (or `= 40 Piece`).

### Step 4.2: Inventory Screen (`/inventory`)
1. Navigate to **Inventory** (`/inventory`).
2. Locate *Pillow*.
3. **Expected Result:**
   - Stock on-hand column renders `X Carton + Y Piece`.
   - Tooltip `= Total Piece` appears on hover.

### Step 4.3: Item Search Modal
1. Press `Ctrl+K` or click the Item Search trigger from anywhere in the app.
2. Search for `Pillow`.
3. **Expected Result:**
   - The search results list displays available stock as `X Carton + Y Piece`.

### Step 4.4: Stock Reports
1. Navigate to **Reports → Stock Valuation / Low Stock / Slow Movers**.
2. **Expected Result:**
   - The on-screen stock columns display the decomposed pack format with tooltip.

---

## 6. Phase 5: POS Till Selling by the Box (O-4)

### Objective
Verify cash and credit sales at the POS till: default pack selection, scanning pack barcodes, mixed quantities, custom price overrides with below-cost warnings, and receipt printing.

### Step 6.1: Default Unit in POS Cart
1. Navigate to **Point of Sale** (`/pos`).
2. Ensure an active cash session is open.
3. Click the *Pillow* product card or search for it.
4. **Expected Result:**
   - Added to cart defaulting to **1 Carton** at `15,000.00 DZD`.
   - Total = `15,000.00 DZD`.

### Step 6.2: Scan Box Barcode
1. In the barcode search input, enter or scan the box barcode: `6130009990011`.
2. Press Enter.
3. **Expected Result:**
   - Automatically increments the existing *Pillow* line by 1 Carton (now 2 Cartons) or adds a 1 Carton line.

### Step 6.3: Sell Mixed Quantity (Cartons + Extra Pieces)
1. On the *Pillow* cart line:
   - Quantity of cartons: `1`.
   - In the **Extra Pieces** field, enter `5`.
2. Observe the rate computation:
   - 1 Carton = `15,000.00 DZD`.
   - 1 Extra piece at carton rate = `round_half_up(15,000.00 / 12) = 1,250.00 DZD`.
   - 5 Extra pieces = `5 × 1,250.00 = 6,250.00 DZD`.
   - Total line price = `15,000.00 + 6,250.00 = 21,250.00 DZD`.
3. **Expected Result:**
   - Line description shows: **`= 17 Piece · 5 Piece at 1,250.00 (Carton rate)`**.
   - Subtotal = **`21,250.00 DZD`**.

### Step 6.4: Overflow Extra Pieces into Cartons
1. Click the `+` button on the extra pieces input until it exceeds 11 pieces:
2. **Expected Result:**
   - At 12 pieces, the line automatically carries over to **`2 Carton + 0 Piece`**.

### Step 6.5: Switch Line to Base Unit (Pieces alone)
1. On a line with cartons, click the unit toggle to switch to **`Piece`**:
2. **Expected Result:**
   - Line resets to base unit selling (e.g. `1 Piece` at `1,250.00 DZD`).
   - Pieces sold alone use the standard piece price, not the carton rate.

### Step 6.6: Price Override & Below-Cost Warning
1. On a 1 Carton line, click the price edit button.
2. Change the carton price to `9,000.00 DZD` (which is below the cost of `12,000.00 DZD`).
3. **Expected Result:**
   - An amber warning appears: **`Below cost / Sous le coût / أقل من التكلفة (1,000.00 per Piece)`**.
   - An indicator badge **`edited / modifié / معدّل`** appears.
   - **Crucial:** Sale checkout is **NOT** blocked (owner ruling R5).

### Step 6.7: Complete Sale & Print Receipt
1. Click **Pay Cash** (or Credit Sale).
2. Enter received amount and confirm checkout.
3. **Expected Result:**
   - Sale posts atomically.
   - Inventory decrements accurately in base units.
   - Receipt preview / physical thermal print displays:
     - `1 Carton` at `15,000.00 DZD`
     - Extra pieces line: `5 Piece at 1,250.00 (Carton rate)`
     - Total = `21,250.00 DZD`.

### Step 6.8: Void Sale & Stock Restoration
1. Open the recent sales / cash session drawer.
2. Select the sale just made and click **Void Sale**.
3. **Expected Result:**
   - Void slip prints with pack details and void stamp.
   - All pieces are restored to inventory stock on-hand.

---

## 7. Phase 6: Multi-Language & RTL Verification (O-6)

### Objective
Verify that all packaging terms are cleanly translated without missing keys, placeholder corruption, or layout clipping in French and Arabic.

### Step 7.1: French (`fr`) Language Test
1. In the app header/settings, switch language to **Français**.
2. Navigate to Products, POS, and Inventory.
3. **Expected Terminology:**
   - Pack / Packs: `Conditionnement` / `Conditionnements`
   - Main Pack: `Conditionnement principal`
   - Carton: `Carton`
   - Unit / Piece: `Pièce`
   - Holds {n} {base}: `Contient {n} {base}`
   - Extra {base}: `{base} en plus`
   - Below Cost: `Sous le coût`
   - Edited badge: `modifié`
   - Buy Only: `Non vendu (achat uniquement)`

### Step 7.2: Arabic (`ar`) & RTL Test
1. Switch language to **العربية**.
2. **Expected Terminology & Layout:**
   - Entire application flips to **Right-to-Left (RTL)** layout.
   - Quantities and tabular numbers align to the left side of cells as appropriate.
   - Terminology:
     - Pack: `تعبئة / تعبئات`
     - Main Pack: `التعبئة الرئيسية`
     - Carton: `كرتون`
     - Piece: `قطعة`
     - Holds: `يحتوي على {n} {base}`
     - Extra pieces: `{base} إضافية`
     - Below Cost: `أقل من التكلفة`
     - Edited badge: `معدّل`
     - Buy Only: `غير مباع (للشراء فقط)`
   - No placeholder tokens (e.g. `{base}`) are displayed raw; they are replaced with localized names.

---

## 8. Comprehensive Verification Results Checklist

| Area | Checkpoint | Status | Notes |
|---|---|---|---|
| **Version** | `[ version = WS-O-6.1 ]` on dashboard & setup | [ ] Pass | |
| **Catalog** | Create pack with holds, price, barcode | [ ] Pass | |
| **Catalog** | Suggested max price helper works | [ ] Pass | |
| **Catalog** | Negative validations (decimals, factor <= 1, duplicate barcode) | [ ] Pass | |
| **Catalog** | Replicate packs to sibling variants | [ ] Pass | |
| **Purchasing** | Default unit is main pack in stock receipt | [ ] Pass | |
| **Purchasing** | Extra pieces costed at carton rate | [ ] Pass | |
| **Purchasing** | WAC and base inventory update accurately | [ ] Pass | |
| **Adjustments**| Default unit is main pack; shows `= {baseQty} {base}` | [ ] Pass | |
| **Display** | Products list shows `2 Carton + 5 Piece` + tooltip | [ ] Pass | |
| **Display** | Inventory screen shows `X Pack + Y Unit` | [ ] Pass | |
| **Display** | Item search modal shows pack quantities | [ ] Pass | |
| **POS Till** | Auto-defaults to main pack upon tile click | [ ] Pass | |
| **POS Till** | Scanning box barcode increments pack quantity | [ ] Pass | |
| **POS Till** | Mixed line: carton + extra pieces at carton rate | [ ] Pass | |
| **POS Till** | Overflow carry: 12 extra pieces becomes +1 pack | [ ] Pass | |
| **POS Till** | Price override shows `edited` badge and below-cost warning | [ ] Pass | |
| **POS Till** | Below-cost warning does NOT block sale checkout | [ ] Pass | |
| **Receipts** | Thermal receipt prints carton & extra piece lines | [ ] Pass | |
| **Void** | Void restores stock in base units; void slip prints | [ ] Pass | |
| **French** | Accurate French copy (`Conditionnement`, `Sous le coût`, etc.) | [ ] Pass | |
| **Arabic** | Clean RTL alignment, no clipping, correct glossary | [ ] Pass | |
