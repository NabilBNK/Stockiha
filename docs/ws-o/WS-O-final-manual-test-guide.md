# WS-O — Buy and Sell by the Box: Complete Manual Test Guide

**Target Version:** `[ version = WS-O-6.1 ]`  
**Target Environment:** Windows Desktop (Tauri v2 + WebView2 + PostgreSQL 18)  
**Workstream:** WS-O (Units & Packaging — "boxes and pieces", Sub-plans O-1 to O-6)

---

## 1. Pre-Flight Verification

1. Launch Stockiha or verify running instance.
2. Check Dashboard / Setup footer:
   - **Expected:** `[ version = WS-O-6.1 ]` is displayed.

---

## 2. Test Scenarios

### Scenario A — Pack Configuration in Catalog (O-1 & O-2)
1. **Navigate to Catalog / Products (`/products` or `/catalog`):**
   - Open a product (e.g. *Pillow* / *Oreiller* with base unit *Piece* / *Pièce*).
   - In the detail panel, locate the **Packs / Conditionnements / التعبئات** section.
2. **Add a Main Pack:**
   - Click **Add Pack / Ajouter un conditionnement / إضافة تعبئة**.
   - Select unit: **Carton / كرتون**.
   - Set holds / factor: `12` pieces.
   - Set sale price: `15,000.00 DZD` (Suggested max price is computed from base price × factor).
   - Mark as **Main pack / Conditionnement principal / التعبئة الرئيسية**.
   - Add a dedicated barcode (e.g. `6130009990011`).
   - Save.
   - **Expected:** Pack saved successfully. Row shows `12 Pieces`, `15,000.00 DZD`, `= 1,250.00 per Piece`, Main badge, and barcode.
3. **Add a Buy-Only Pack:**
   - Add another pack with unit **Bale / Balle / فاردو** holding `24` pieces.
   - Leave sale price blank (Buy-only).
   - Save.
   - **Expected:** Display shows `Not sold (buy only) / Non vendu (achat uniquement) / غير مباع (للشراء فقط)`.
4. **Copy & Apply to Other Variants:**
   - Click **Apply to other variants / Appliquer aux autres variantes / تطبيق على المتغيرات الأخرى**.
   - Select sibling variants and apply.
   - **Expected:** Sibling variants inherit the pack definition without duplicate barcodes.

---

### Scenario B — Inventory On-Hand & Display Everywhere (O-5)
1. **Products Table:**
   - For a product variant holding 29 pieces in stock with a 12-piece Carton pack:
   - **Expected:** Quantity column displays **`2 Carton + 5 Unit`** (or `2 Carton + 5 Pièce`).
   - Hover mouse over the quantity:
   - **Expected:** Tooltip reads **`= 29 Unit`** (or `= 29 Pièce`).
2. **Inventory Screen (`/inventory`):**
   - Open the inventory list.
   - **Expected:** On-hand quantity column displays pack-decomposed format (`X Pack + Y Unit`) with tooltip.
3. **Item Search Modal:**
   - Open Item Search (e.g. via `Ctrl+K` or search trigger in documents/sales).
   - **Expected:** Quantity column shows pack quantities with tooltip.
4. **Stock Reports:**
   - Open Stock Valuation, Low Stock, and Slow Movers reports.
   - **Expected:** On-screen table displays pack-formatted stock.

---

### Scenario C — Stock Adjustment with Packs (O-5)
1. Open **Stock Adjustments (`/inventory/adjustments`)**:
   - Select the variant configured with a Carton pack.
   - **Expected:** Default unit automatically switches to **Carton**.
   - Type quantity `2`:
   - **Expected:** Under the quantity input, helper text shows **`= 24 Unit`** (using `pack.display.equals`).
   - Switch unit dropdown back to base unit (Piece) if desired:
   - **Expected:** Helper text disappears or updates to base units.

---

### Scenario D — Purchase & Stock Receipt by the Box (O-3)
1. **Receive Stock / Purchase Order:**
   - Create a stock receipt for *Pillow*.
   - Select unit **Carton** (factor 12) with quantity `3` and extra pieces `4`.
   - Enter carton cost (e.g. `12,000.00 DZD` per Carton).
   - **Expected:**
     - Total pieces received = `3 × 12 + 4 = 40 Pieces`.
     - Extra pieces unit cost rate = `12,000 / 12 = 1,000.00 DZD/piece`.
     - Provisional total = `(3 × 12,000) + (4 × 1,000) = 40,000.00 DZD`.
2. **Post Receipt:**
   - Post document.
   - **Expected:** Stock increases by exactly 40 base units; warehouse WAC updates accordingly in immutable ledger.

---

### Scenario E — Sell by the Box at the POS Till (O-4)
1. **Add Product to Till:**
   - Open active POS cash session.
   - Select or search for *Pillow*.
   - **Expected:** Adds to cart defaulting to **Carton** (main pack).
2. **Scan Pack Barcode:**
   - Scan barcode `6130009990011`.
   - **Expected:** Increments Carton line by 1 pack.
3. **Mixed Quantity (Boxes + Extra Pieces):**
   - In cart line, enter `1` Carton and `4` Extra Pieces.
   - Base pack price = `15,000.00 DZD` (holds 12 pieces).
   - Calculated piece rate = `round_half_up(15,000 / 12) = 1,250.00 DZD`.
   - Line subtotal = `15,000 + (4 × 1,250) = 20,000.00 DZD`.
   - **Expected:** Subtotal displays `20,000.00 DZD`, showing `(+ 4 extra at 1,250.00)`.
4. **Price Editing & Cost Warning:**
   - Edit the carton price to `9,000.00 DZD` (below cost).
   - **Expected:** Amber warning **`Below cost / Sous le coût / أقل من التكلفة`** appears with badge `edited / modifié / معدّل`. Sale remains permitted.
5. **Checkout & Receipts:**
   - Pay cash and complete sale.
   - **Expected:**
     - Sale posts cleanly and atomically.
     - Printed receipt (thermal 80mm / A4) clearly states `1 Carton + 4 Piece` with carton rate.
     - Stock decrements by `16` pieces.

---

### Scenario F — Language & RTL Localization (O-6)
1. **Switch to French (`fr`):**
   - Verify terminology:
     - "Conditionnement", "Conditionnement principal", "Contient {n} {base}", "{base} en plus", "(au prix du {unit})", "Non vendu (achat uniquement)", "modifié", "Sous le coût".
2. **Switch to Arabic (`ar`):**
   - Verify right-to-left layout:
     - Numbers and tables align cleanly in RTL.
     - Terminology: "تعبئة", "التعبئة الرئيسية", "يحتوي على {n} {base}", "{base} إضافية", "(بسعر {unit})", "غير مباع (للشراء فقط)", "معدّل", "أقل من التكلفة".
3. **Switch to English (`en`):**
   - Verify all baseline English labels and formulas (`= {baseQuantity} {base}`) remain intact.

---

## 3. Verdict Checklist

| # | Step | Expected Result | Pass / Fail |
|---|---|---|---|
| 1 | Marker Check | `[ version = WS-O-6.1 ]` on Dashboard and Setup | [ ] |
| 2 | Pack Management | Create, edit, set primary, set active, barcode | [ ] |
| 3 | Sibling Replication | Apply pack to sibling variants without duplicate barcodes | [ ] |
| 4 | Display Everywhere | Decomposed packs format in Catalog, Inventory, Search, Reports | [ ] |
| 5 | Stock Adjustment | Auto-defaults to pack; shows `= {baseQty} {base}` | [ ] |
| 6 | POS Till Sale | Default pack in cart; extra pieces at pack rate; receipt prints pack lines | [ ] |
| 7 | Below-Cost Warning | Amber warning shown, does not block checkout | [ ] |
| 8 | Localization | Accurate French and Arabic translations; RTL layout integrity | [ ] |
