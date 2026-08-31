---
version: "2.0.0"
name: Stockiha
description: >
  Single-company, single-store Windows desktop ERP (Tauri v2 + React 19).
  Supports EN / FR / AR with RTL layout. Operational product — cashiers, managers,
  administrators. Data-dense, trust-first, accessibility-critical.
  Light and dark themes. User-configurable accent colour.
  Touch-capable POS terminal with mouse and keyboard fallback.

colors:
  # ── Backgrounds (light) ──────────────────────────────────────
  bg: "#fbf9f7"
  surface: "#ffffff"
  surface-soft: "#f5f2ee"
  surface-hover: "#f0ece7"
  surface-sunken: "#ebe6df"

  # ── Borders (light) ──────────────────────────────────────────
  border: "#e2dcd4"
  border-strong: "#cfc6bb"

  # ── Text (light) ─────────────────────────────────────────────
  text: "#1c1917"
  text-soft: "#57534e"
  muted: "#6f675e"
  disabled: "#9c948a"

  # ── Navigation sidebar (light) ───────────────────────────────
  # Theme-following, but a deliberately distinct surface step.
  nav: "#e8e1d7"
  nav-soft: "#ded6ca"
  nav-text: "#332e29"
  nav-text-muted: "#655d55"
  nav-border: "#d3cabd"

  # ── Accent / Primary — USER-CONFIGURABLE (see §4) ────────────
  # Single stored value. All variants below are DERIVED, never hand-set.
  accent: "#c25012"
  accent-hover: "derived"
  accent-active: "derived"
  accent-soft: "derived"
  accent-border: "derived"
  accent-text: "derived"
  accent-contrast: "derived"

  # ── Semantic status — FIXED, never themeable ─────────────────
  ok: "#16815d"
  ok-soft: "#eaf8f2"
  danger: "#c0393f"
  danger-soft: "#fff0f0"
  warn: "#a2630b"
  warn-soft: "#fff6df"
  info: "#1d4ed8"
  info-soft: "#ebf1fe"

  # ── Dark theme overrides (resolved at [data-theme="dark"]) ───
  dark-bg: "#14110e"
  dark-surface: "#1c1815"
  dark-surface-soft: "#241f1a"
  dark-surface-hover: "#2a241e"
  dark-surface-sunken: "#100e0b"
  dark-border: "#2a241e"
  dark-border-strong: "#4a4137"
  dark-text: "#f5f1ec"
  dark-text-soft: "#b8afa5"
  dark-muted: "#9a9085"
  dark-disabled: "#5c554c"
  dark-nav: "#080706"
  dark-nav-soft: "#161210"
  dark-nav-text: "#c9c1b7"
  dark-nav-text-muted: "#847b71"
  dark-nav-border: "#241f1a"
  dark-ok: "#54d2a3"
  dark-ok-soft: "#15352e"
  dark-danger: "#ff7b82"
  dark-danger-soft: "#391d25"
  dark-warn: "#f2ba62"
  dark-warn-soft: "#3b2b14"
  dark-info: "#60a5fa"
  dark-info-soft: "#101c33"

typography:
  headline-display:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.6rem, 2vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline-lg:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  headline-md:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 700
    lineHeight: 1.35
  body-lg:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-md:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label-lg:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.2
  label-md:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.035em"
    fontFeature: "tnum"
  label-sm:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "0.08em"
  metric-value:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.9rem, 2.6vw, 2.4rem)"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "tnum"
    fontVariation: "numeric tabular"
  mono:
    fontFamily: "Cascadia Code, Consolas, JetBrains Mono, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  arabic-body:
    fontFamily: "Noto Kufi Arabic, Cairo, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65

textScale:
  # Global multiplier applied to the whole type scale (see §11.2)
  normal: 1.0
  large: 1.15
  xlarge: 1.3

rounded:
  none: "0px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  full: "9999px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
  xxl: "36px"

layout:
  shell-header-height: "70px"
  shell-nav-width: "264px"
  shell-nav-width-collapsed: "76px"
  context-bar-height: "52px"
  context-rail-width: "360px"
  context-rail-collapse-below: "1440px"
  status-bar-height: "34px"
  min-supported-width: "1280px"
  content-max-width-forms: "1380px"
  content-max-width-tables: "none"

touch:
  target-min: "44px"
  target-min-touch-screen: "48px"
  target-gap-min: "8px"

components:
  # Shell
  shell-header:
    height: "{layout.shell-header-height}"
    backgroundColor: "{colors.surface}"
    padding: "0 22px"
  shell-nav:
    width: "{layout.shell-nav-width}"
    widthCollapsed: "{layout.shell-nav-width-collapsed}"
    backgroundColor: "{colors.nav}"
    borderInlineEnd: "1px solid {colors.nav-border}"
    padding: "18px 12px 28px"
  shell-main:
    backgroundColor: "{colors.bg}"
    padding: "clamp(20px, 2.5vw, 36px)"
  shell-status-bar:
    height: "{layout.status-bar-height}"
    backgroundColor: "{colors.nav}"
    borderBlockStart: "1px solid {colors.nav-border}"

  # Navigation
  nav-group-label:
    typography: "{typography.label-sm}"
    textColor: "{colors.nav-text-muted}"
    textTransform: "uppercase"
    padding: "18px 11px 6px"
  nav-item:
    minHeight: "44px"
    padding: "9px 11px"
    rounded: "{rounded.sm}"
    backgroundColor: "transparent"
    textColor: "{colors.nav-text}"
    typography: "{typography.body-md}"
  nav-item-hover:
    backgroundColor: "{colors.nav-soft}"
    textColor: "{colors.text}"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text}"
    accentRule: "3px {colors.accent} inline-start"
    fontWeight: 700
  nav-badge:
    minHeight: "22px"
    padding: "2px 8px"
    rounded: "{rounded.full}"
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.text-soft}"
    typography: "{typography.label-md}"

  # Cards
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "20px"
    border: "1px solid {colors.border}"
  metric-strip:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.border}"
    dividerColor: "{colors.border}"
  metric-cell:
    padding: "20px 22px"
    minHeight: "104px"
  metric-icon:
    width: "42px"
    height: "42px"
    rounded: "12px"
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"

  # Buttons — 44px minimum, always
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.sm}"
    padding: "8px 17px"
    minHeight: "{touch.target-min}"
    fontWeight: 700
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 17px"
    minHeight: "{touch.target-min}"
    border: "1px solid {colors.border}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 17px"
    minHeight: "{touch.target-min}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.sm}"
    padding: "8px 17px"
    minHeight: "{touch.target-min}"
  button-touch-primary:
    minHeight: "64px"
    padding: "14px 28px"
    typography: "{typography.headline-md}"
    rounded: "{rounded.md}"

  # Inputs
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    minHeight: "{touch.target-min}"
    border: "1px solid {colors.border-strong}"
  input-focus:
    border: "1px solid {colors.accent}"
  input-small:
    width: "110px"
    minHeight: "44px"
  numeric-keypad-key:
    minHeight: "{touch.target-min-touch-screen}"
    minWidth: "{touch.target-min-touch-screen}"
    rounded: "{rounded.sm}"
    typography: "{typography.headline-md}"

  # Badges / status chips
  badge-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  badge-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  badge-warn-outline:
    backgroundColor: "transparent"
    textColor: "{colors.warn}"
    border: "1px solid {colors.warn}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  badge-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  badge-neutral:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: "3px 10px"

  # Tables
  table-header:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    typography: "{typography.label-sm}"
    minHeight: "42px"
  table-row:
    minHeight: "48px"
    typography: "{typography.body-lg}"
  table-row-hover:
    backgroundColor: "{colors.surface-hover}"

  # Icon buttons
  icon-button:
    width: "{touch.target-min}"
    height: "{touch.target-min}"
    rounded: "10px"
    backgroundColor: "{colors.surface-soft}"
    border: "1px solid {colors.border}"

  # Brand
  brand-logo:
    width: "38px"
    height: "38px"
    rounded: "11px"
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-contrast}"
---

# Stockiha Design System

> **Version 2.0.0.** This revision merges the established v1 design system with an approved new visual direction (warm surfaces, grouped navigation, KPI strip, context rail, status bar), a user-configurable accent colour, and a full Accessibility & Inclusive Use standard.
>
> **v1 content retained deliberately:** token architecture, IPC/architecture boundary, ARIA floor, RTL/Arabic rules, 44px touch minimum, component specs (modals, banners, forms, grid), and the Do's/Don'ts. These were not regressions to be replaced — they were the strongest part of v1.
>
> **Design-system guidance only. Not product/roadmap authority.** Scope and priorities are defined by [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md). This file governs how authorised work should look, not what gets built.

---

## 0. Migration status and open reconciliations

This document describes the **target** system. Product Frontend is assessed at **4.0/10** in the ground truth; migration belongs to **WS-J**, with accent configuration in **WS-C**.

**Verify against the codebase before implementing — not assumed here:**

| Item | Why |
|---|---|
| `src/styles/global.css` current variable names | v1 declared this file must match the tokens here. v2 changes colour values and adds derived accent tokens. Alias, don't blind-rename. |
| Existing `--sk-*` token consumers | v1 referenced `--sk-touch` and `--sk-gap`. Find all consumers before changing values. |
| WebView2 version on target Windows machines | Determines `color-mix()` availability (§4.3). |
| Existing components built against v1 cobalt/navy | Colour migration is mechanical but wide. Sequence it (§14). |

**Changed from v1 — review before accepting:**

| Topic | v1 | v2 | Rationale |
|---|---|---|---|
| Primary colour | Cobalt `#2457d6`, fixed | Accent `#c25012` default, **user-configurable** | Owner requirement: personalisation from Settings |
| Sidebar | Deep navy, theme-independent | Theme-following, **distinct surface step** | See §3.2 — preserves figure/ground separation without constraining accent choice |
| Base surface | Cool blue-grey `#f4f7fb` | Warm off-white `#fbf9f7` | Approved mockup direction; warm neutrals reduce perceived glare over long shifts |
| Body text | 15px | **16px** | Accessibility floor for 8-hour daily use and older users (§11.2) |
| Table row height | unspecified | 48px | Accommodates 16px body text with comfortable padding |
| Content max width | 1380px everywhere | 1380px **forms only**; tables full-width | Wide tables benefit from width; forms do not |

**Unchanged from v1 — deliberately:** radius scale, spacing scale, shadow/elevation model, badge pill shape, 44px touch minimum, ARIA floor, RTL rules, architecture boundary.

---

### WS-D scope ruling (approved)

> **Approved by the Project Owner.** This ruling is binding for WS-D. Do not "helpfully" swap the palette or extend RTL layout during WS-D — both are explicit, deliberate exclusions below, not oversights.

WS-D adopts from DESIGN.md v2: layout regions, grid patterns, 16px body text, 48px table row height, full-width tables with 1380px-capped forms, the five button variants, 44px touch minimum, spacing scale, radius scale, elevation model.

WS-D deliberately does NOT adopt: the warm off-white base surface (`#fbf9f7`), the theme-following sidebar, or the `#c25012` accent. Primary colour remains `#2457d6`. These three land globally in WS-J, in one pass, to avoid a partially repainted application.

Arabic RTL layout is frozen for WS-D. Arabic translation strings are in scope; RTL layout work is deferred. Do not remove or break existing RTL support — just do not extend it.

---

## 1. Overview

Stockiha is a **single-company, single-store Windows desktop ERP** built with Tauri v2, React 19, and TypeScript. It serves three user tiers: cashiers at the POS, store managers overseeing inventory and procurement, and administrators managing configuration and opening state.

**Design personality:** Operational precision. Every pixel earns its place. The interface feels like a professional tool, not a marketing site. Clarity, density, and trust over decoration.

**Audience — design for the least technical person who will use this, not the most:**

- **Cashiers:** speed and clarity at POS; zero tolerance for ambiguous states. Often the least computer-literate users. May be operating a touchscreen.
- **Managers:** data density with clear hierarchy; quick scanning over deep reading.
- **Administrators:** control and auditability; progressive disclosure for destructive actions.

**Locale support:** EN (LTR), FR (LTR), AR (RTL). All layout, spacing, and directional rules must be logical (inline/block), never physical (left/right).

**Theme:** Light (default) and Dark. Both are **full-coverage** — no light sections inside a dark page or vice versa. Set once at the document root via `[data-theme="dark"]`.

**Input:** Mouse and keyboard on administrative screens. **Touchscreen-primary on low-typing screens** (Point de Vente and equivalents), with mouse and keyboard always working as fallback (§12).

**Aesthetic family:** Enterprise-clean / functional precision. Comparable to Linear's operational density in a native Windows desktop context. No frosted glass, no centred hero sections, no illustration-heavy empty states.

**Design Dials:**
- `DESIGN_VARIANCE: 5` — structural consistency with targeted intentional variation
- `MOTION_INTENSITY: 3` — functional micro-transitions only; no decorative animation
- `VISUAL_DENSITY: 7` — data-dense, moderated slightly from v1's 8 to accommodate the 16px text floor

---

## 2. Design principles

1. **Calm surface, dense content.** Chrome stays quiet so data can be dense without being loud. Restraint in the frame is what makes density survivable across an eight-hour shift.
2. **Colour carries meaning or nothing.** Accent marks *what is active or primary*. Semantic marks *state*. Decorative colour does not exist in this system.
3. **Numbers are the product.** Tabular alignment, consistent formatting, and visual priority over their labels.
4. **The interface never invents truth.** The frontend renders backend-computed values. It does not calculate money, stock, margins, or permissions.
5. **Visibility is not authorisation.** Hiding a control is usability. Authorisation is enforced at the PostgreSQL `SECURITY DEFINER` boundary, always.
6. **Simplicity is a feature, not a compromise.** Where density and comprehensibility conflict, comprehensibility wins.

---

## 3. Colours

### 3.1 Accent — user-configurable

The accent replaces v1's fixed cobalt. It is a **single stored value** from which every variant is derived. Full specification in §4.

Default: `#c25012`. Configurable from **Paramètres → Apparence** and from the topbar swatch shortcut, both writing the same stored setting.

> **On the default value.** The approved mockup used `#ea6a25`. That value reaches only **3.19:1** against white and fails AA as a button fill and as text. `#c25012` is the same hue family darkened to **4.72:1**, which passes AA in both roles. Do not restore the lighter orange as the default — it would ship a WCAG failure on the most frequently rendered surface in the application. If the lighter orange is wanted visually, it must be paired with near-black text rather than white, which changes the button's character.

### 3.2 Surfaces and the sidebar decision

Light theme uses a **warm off-white** base (`#fbf9f7`). Surfaces step `bg → surface → surface-soft`, creating elevation without shadows.

Dark theme uses a **warm near-black** base (`#14110e`) — not pure black, not blue-black — which keeps eye strain low during long shifts.

**The sidebar follows the theme, but is a deliberately distinct surface step.**

| Theme | App background | Sidebar | Relationship |
|---|---|---|---|
| Light | `#fbf9f7` | `#e8e1d7` | Sidebar clearly **darker** |
| Dark | `#14110e` | `#080706` | Sidebar clearly **darker** |

This supersedes v1's theme-independent navy sidebar. The reasoning for each property:

- **Why still a distinct step (v1's goal, preserved):** a visibly different surface makes "this column is navigation, that area is work" unmistakable — including for users with no computer background. A sidebar separated only by a hairline border is too subtle for that audience.
- **Why theme-following (changed from v1):** a fixed navy sidebar constrains accent customisation severely. The active nav item is the most-seen accent surface in the application; against navy, any deep blue, indigo, or violet accent becomes invisible. Fixing the sidebar would mean rejecting a large part of the colour wheel from a feature sold as "pick your colour."
- **What is lost:** v1's cross-theme orientation anchor. Mitigation: orientation is carried by **position and grouped section headings** (§7.2) rather than by colour — structure through typography.

**Sidebar contrast is a hard requirement, not a preference.** If implementation renders the sidebar and app background as near-identical (a difference invisible at arm's length on a real monitor), that is a defect against this section.

### 3.3 Semantic status colours — fixed, never themeable

Status colours communicate financial and operational outcomes. Never decorative. **Never overridden by the accent.**

| State | Light fg | Light bg | Dark fg | Dark bg | Use |
|---|---|---|---|---|---|
| OK / success | `#16815d` | `#eaf8f2` | `#54d2a3` | `#15352e` | Confirmed, posted, paid, open session, synchronised |
| Danger / error | `#c0393f` | `#fff0f0` | `#ff7b82` | `#391d25` | Failed, overdrawn, rejected, below threshold, variance |
| Warning | `#a2630b` | `#fff6df` | `#f2ba62` | `#3b2b14` | Pending approval, partial receipt, low stock |
| Info | `#1d4ed8` | `#ebf1fe` | `#60a5fa` | `#101c33` | Neutral informational banners |

**Accent/semantic collision rule.** A user may set an accent close to a semantic colour (e.g. green accent beside success green). Semantic meaning still wins, because **status always carries a text label** and colour is only reinforcement (§10.4). This is why colour-alone status indication is banned — it makes the accent feature safe.

**The accent must never be used to communicate state.** Accent = active or primary. Semantic = state. Merging them is a defect.

---

## 4. Accent theming system

### 4.1 Storage

One hex value in application settings. Suggested key: `ui.accent_color`. Default `#c25012`. Owned by WS-C (Settings & Policy Engine), persisted per user.

### 4.2 Derived variants

Every accent token except the base is **computed**, never hand-authored:

| Token | Derivation | Use |
|---|---|---|
| `accent` | stored value | Primary buttons, active nav rule, brand mark |
| `accent-hover` | darkened ~12% | Primary button hover |
| `accent-active` | darkened ~22% | Primary button pressed |
| `accent-soft` | accent at 12% over `surface` | Active nav fill, metric icon background, active filter pill |
| `accent-soft-hover` | accent at 18% over `surface` | Hover on accent-tinted surfaces |
| `accent-border` | accent at 45% over `border` | Outlined accent controls |
| `accent-text` | accent adjusted to reach 4.5:1 on `surface` | Accent-coloured text and icons |
| `accent-contrast` | `#ffffff` or `#1c1917`, whichever reaches 4.5:1 on `accent` | Text on accent-filled surfaces |

Because `accent-soft` mixes against `surface`, it adapts to light and dark automatically.

### 4.3 Implementation

**Option A — compute in TypeScript (recommended).** On theme load, read the stored hex, compute all variants in code, write them as CSS custom properties on the document root. Deterministic, no browser feature dependency, and the contrast maths lives in one place.

**Option B — `color-mix()` in CSS.** Simpler, but requires Chromium 111+ in WebView2. Verify on the target Windows machine before relying on it. v1 already used `color-mix()` in one focus-ring rule, so partial support may already be assumed — confirm rather than infer.

### 4.4 Contrast guard — mandatory

A user-chosen colour must never produce unreadable UI:

1. Compute `accent-contrast` from the accent's relative luminance. If neither white nor near-black reaches **4.5:1**, adjust the accent *as used for filled surfaces* until it does.
2. Compute `accent-text` independently — readable on a button ≠ readable as text on white.
3. Verify `accent-soft` against `text` for the active nav item in **both** themes.
4. In the Settings picker, warn or reject colours that cannot satisfy the above after adjustment.

### 4.5 Presets

Offer a curated, pre-validated palette (orange, cobalt, teal, green, violet, slate) plus a custom hex field subject to §4.4. Cobalt `#2457d6` is retained as a preset so v1's identity remains available.

---

## 5. Typography

### 5.1 Font stack

```
"Segoe UI", Inter, system-ui, -apple-system, "Noto Kufi Arabic", Cairo, sans-serif
```

**Rationale (v1, retained):** Segoe UI is the native Windows system font — device-pixel-density rendering with ClearType hinting, zero flash-of-unstyled-text, no network request. Inter follows as fallback. Arabic uses Noto Kufi Arabic or Cairo, both supporting the connected script forms required for commercial AR content.

Monospace (`Cascadia Code, Consolas, JetBrains Mono`) is used **only** for document references, barcodes, SKUs, and IDs — where character-by-character comparison matters.

**No serif fonts.** Editorial character conflicts with a trust-first, data-dense operational tool.

### 5.2 Type scale

Body text is **16px**, raised from v1's 15px as an accessibility floor (§11.2). Density is achieved through spacing and layout discipline, never by shrinking text.

| Token | Size | Weight | Use |
|---|---|---|---|
| `headline-display` | `clamp(1.6rem, 2vw, 2rem)` | 700 | `<h1>` — page title |
| `headline-lg` | `1.25rem` | 700 | `<h2>` — section heading |
| `headline-md` | `1.1rem` | 700 | `<h3>` — card heading |
| `body-lg` | `16px` | 400 | **Default body, table rows** |
| `body-md` | `15px` | 400 | Secondary body, descriptions |
| `body-sm` | `14px` | 400 | Captions, helper text, timestamps |
| `label-lg` | `14px` | 700 | Form labels |
| `label-md` | `13px` | 700 | Table column headers, metric labels (`tnum`) |
| `label-sm` | `12px` | 750 | Nav group labels, eyebrows (uppercase, `+0.08em`) |
| `metric-value` | `clamp(1.9rem, 2.6vw, 2.4rem)` | 800 | KPI numbers (`tnum`) |
| `mono` | `15px` | 400 | Document references, barcodes, SKUs |
| `arabic-body` | `16px` | 400 | Body text when `lang="ar"` (line-height 1.65) |

The entire scale scales together under the **Taille du texte** setting (§11.2) — a proportional multiplier, never per-element overrides.

### 5.3 Tabular numerals — mandatory

`font-feature-settings: "tnum"` on **all** financial amounts, quantities, dates, and document numbers. Values must not cause column reflow as they update. Proportional figures are measurably slower to scan and more fatiguing across repeated reads.

---

## 6. Layout

### 6.1 Application shell

```
┌────────────────────────────────────────────────────────────┐
│ Header (70px, full width)                                  │
├──────────────┬─────────────────────────────────────────────┤
│              │ Context bar (52px) — breadcrumb + ranges     │
│ Nav sidebar  ├─────────────────────────────────────────────┤
│ 264px        │ KPI strip                                    │
│ (76px if     ├──────────────────────────┬──────────────────┤
│ collapsed)   │ Main content             │ Context rail     │
│              │ minmax(0, 1fr)           │ 360px            │
│              ├──────────────────────────┴──────────────────┤
│              │ Status bar (34px)                            │
└──────────────┴─────────────────────────────────────────────┘
```

| Region | Size | Behaviour |
|---|---|---|
| Header | 70px | Fixed. `surface` background, bottom border. |
| Sidebar | 264px / 76px collapsed | `nav` background, inline-end border. Direction-aware. |
| Context bar | 52px | Only where breadcrumb or range filters apply. |
| KPI strip | auto | Only on dashboard/report screens. |
| Main | `minmax(0, 1fr)` | `bg` background. Full width for tables; `1380px` centred for forms and settings. |
| Context rail | 360px | Collapses below 1440px viewport width. |
| Status bar | 34px | Always present. Read-only. |
| Min supported width | 1280px | Below this is unsupported. Not a mobile target. |

**Region responsibilities:**

- **Sidebar** — navigation only. Never actions, filters, or data entry.
- **Header** — global search, session state, appearance controls, notifications, identity.
- **Context bar** — where you are, and what period you're viewing.
- **KPI strip** — at-a-glance figures for the current screen and range.
- **Main** — the working surface.
- **Context rail** — supporting and glanceable. **Never the only place a critical action lives.**
- **Status bar** — hardware and system state. Read-only.

### 6.2 Grid system

All multi-column layouts use **CSS Grid**, never percentage flex maths.

| Pattern | Grid definition | Use |
|---|---|---|
| Auto-fit cards | `repeat(auto-fit, minmax(210px, 1fr))` | Product grids, form fields |
| Dashboard split | `minmax(0, 1.35fr) minmax(320px, 0.65fr)` | Main content + context rail |
| KPI strip | `repeat(auto-fit, minmax(190px, 1fr))` | Metric cells, max 5 at 1280px |
| Activity grid | `minmax(220px, 1.35fr) repeat(3, minmax(150px, 1fr))` | Dashboard activity row |
| POS split | `minmax(0, 1.4fr) minmax(360px, 0.6fr)` | Product grid + cart (WS-F) |

---

## 7. Components

### 7.1 Buttons

Five variants. Never invent a sixth without an ADR.

| Variant | Token | When |
|---|---|---|
| `button-primary` | Accent fill, `accent-contrast` text | The single most important action per screen |
| `button-secondary` | Surface fill, border | Secondary or neutral actions |
| `button-danger` | Danger fill, white text | Destructive actions (delete, void, force-close) |
| `button-ghost` | No fill, no border, muted text | Tertiary, inline, or cancel |
| `button-touch-primary` | Accent fill, 64px min-height | The primary action on a touch-designated screen (§12) |

Rules:
- **All buttons have `min-height: 44px`.** No exceptions on any screen.
- Primary CTA label: max 3 words, must fit on one line.
- One primary button per screen section.
- Active state: `transform: scale(0.98)` — and a visible pressed state is **mandatory** on touch screens (§12).
- Focus: `outline: 3px solid` accent at 25% alpha, offset 1px.
- Irreversible actions require a two-step confirm dialog, worded per §11.3.

### 7.2 Navigation

Sidebar items are grouped under uppercase section labels:

| Group | Items |
|---|---|
| `PILOTAGE` | Tableau de bord |
| `STOCK` | Produits, Inventaire, Achats |
| `VENTES` | Point de Vente, Sessions de Caisse, Clients |
| `FINANCE` | Comptabilité, Rapports |
| `SYSTÈME` | Paramètres |

- Group labels: `label-sm` uppercase, `nav-text-muted`. Labels, not controls — not clickable, not collapsible.
- Item labels: `body-md`. Active: `label-lg` weight.
- Active indicator: 3px `accent` rule on **inline-start** + `accent-soft` fill.
- Collapsed mode: icon-only, 46×46px target, centred, with accessible name preserved.
- **RTL:** accent rule moves to `inline-end` via `inset-inline-start`.
- **A group with no visible items renders nothing, including its heading** (§9).

**Navigation badges** — right-aligned counts of items needing attention (`Inventaire 12`, `Achats 3`).

- Default: `badge-neutral`. Escalated: `badge-danger` when the count represents a threshold breach.
- **Omitted entirely when the user lacks permission** to view the underlying data — a count is itself disclosure.
- Counts must be cheap: one batched, cached, mutation-invalidated source. Never a query per badge per render.

### 7.3 Form inputs

- `label-lg` typography **above** the input. Never as placeholder.
- `min-height: 44px`, `border-radius: sm`.
- Focus: `border-color: accent`, `box-shadow: 0 0 0 3px` accent at 13% alpha.
- Error text below input — `body-sm`, `danger`, announced via `role="alert"`.
- Helper text below input (optional) — `body-sm`, `muted`.
- `input-small` variant (110px wide) for quantity/numeric fields — still 44px tall.

### 7.4 Cards and panels

- `border: 1px solid border` + `shadow` + `border-radius: md`.
- Inner padding 20px.
- First `<h2>` child gets a `border-bottom` separator.
- **Cards do not nest.**

### 7.5 KPI strip

A single bordered container divided by 1px vertical rules — **not** separate floating cards. Separate cards at five metrics fragment the eye path.

Each cell: `label-sm` uppercase label (`muted`), `metric-value` figure with `tnum`, optional `body-sm` subtitle carrying a semantic delta.

- Optional 42×42px `metric-icon` with `accent-soft` background.
- A value takes a semantic colour **only** when it represents a threshold breach (e.g. `Stock faible: 12` in `danger`). Normal values stay `text`.
- Five cells maximum at 1280px.
- **Values must never visually jump on refresh** — cross-fade or increment (§11.2).

### 7.6 Tables

- Column headers: `label-sm` uppercase, `muted`, `surface-soft` background, `<th scope="col">`.
- Rows: `body-lg`, 48px min-height, `border-bottom: 1px solid border`, `surface` background.
- Row hover: `surface-hover`. No zebra striping.
- Financial amounts: `tnum`, right-aligned (LTR) / left-aligned (RTL).
- Document references: `mono`.
- Sticky header on long tables: `position: sticky; top: 0; z-index: 2`.
- `aria-sort` on sortable columns.
- Empty state: informative message plus the action that creates the first record. Never blank space.
- Loading: skeleton rows matching final row height — never a spinner that collapses layout height.

### 7.7 Badges / status chips

One-word status labels. No icons inside badges for standard states.

| State | Token | Example |
|---|---|---|
| OK | `badge-ok` | `Payé`, `Synchronisé` |
| Danger | `badge-danger` | `Échec`, `Écart` |
| Warning | `badge-warn` / `badge-warn-outline` | `En attente`, `Reçu partiel` |
| Info | `badge-info` | Informational |
| Neutral | `badge-neutral` | `Envoyé`, `Brouillon` |

- `border-radius: full` (pill).
- **Never use colour alone to convey status — always pair with a text label.**

### 7.8 Banners

Four tones, inline placement.

| Tone | Fill | Inline-start border | Use |
|---|---|---|---|
| `info` | `info-soft` | 3px `info` | Informational guidance |
| `success` | `ok-soft` | 3px `ok` | Operation confirmed |
| `warning` | `warn-soft` | 3px `warn` | Pending action needed |
| `error` | `danger-soft` | 3px `danger` | Action failed |

Banners use **semantic** colours, never the accent — a banner communicates state.

### 7.9 Toolbar / page header

Every list/table screen has a toolbar row:
- Inline-start: page `<h1>` or filter controls (`flex: 1 1 260px`).
- Inline-end: primary action button.
- `margin-bottom: 22px`, `flex-wrap: wrap`, `gap: 12px`.

### 7.10 Context rail cards

Compact list rows: `body-md` label, inline-end value or status badge, `border` separators. A semantic leading dot may indicate row state (open session `ok`, closed session `muted`).

Card titles may carry a count badge matching nav badge styling.

### 7.11 Modals / dialogs

- Overlay: `rgba(0, 0, 0, 0.45)`.
- Dialog: `surface` background, `border-radius: lg`, `shadow-lg`, `max-width: 520px` (wide: `720px`).
- Header: `<h2>` with bottom border.
- Footer: Cancel (ghost) + Confirm (primary or danger), `justify-content: flex-end`.
- Keyboard: Escape closes; **focus trapped inside**; focus returns to the trigger on close.
- Confirmation wording follows §11.3.

### 7.12 Status bar

34px, `nav` background, top border, `body-sm` in `muted`. Segments separated by `xl` spacing:

`Base locale · synchronisée 14:32` · `Poste CAISSE-01` · `Imprimante EPSON TM-T20 · prête` · `Tiroir · fermé` — application version inline-end.

**Hardware states are observed, not claimed.** If a printer or drawer state is unknown, display `état inconnu` — never a green indicator. A false "ready" on an offline printer costs a sale.

---

## 8. Elevation, shape, spacing

### 8.1 Elevation

**Border-first elevation language**, not shadow-first. Shadows supplement; they never replace a border.

| Level | Definition | Use |
|---|---|---|
| 0 — Flat | `background: bg`, no border | Page background |
| 1 — Soft surface | `surface-soft` + `1px border` | Metric cells, table rows |
| 2 — Surface | `surface` + `1px border` + `shadow` | Cards, dropdowns |
| 3 — Elevated | `surface` + `shadow-lg` | Modals, popovers |

**Shadow tint rule:** warm-tinted RGBA in light (`rgba(40, 30, 20, …)`), near-black in dark. Never pure black drop shadows. *(Changed from v1's blue tint to match the warm surface palette.)*

### 8.2 Shape

One radius scale. **No mixing.**

| Token | Value | Use |
|---|---|---|
| `none` | 0px | Hard-edge table cells, full-bleed areas |
| `sm` | 8px | Inputs, buttons, small icon containers |
| `md` | 12px | Cards, modals, standard containers |
| `lg` | 18px | Dashboard panels, large feature cards |
| `full` | 9999px | Badges, pills, status chips |

**Shape-consistency lock:** `sm` for interactive controls; `md`/`lg` for containers. Mixing without a documented exception is a layout error.

### 8.3 Spacing

| Token | Value | Use |
|---|---|---|
| `xs` | 4px | Badge padding, tight gaps |
| `sm` | 8px | Icon gaps, input padding unit, **minimum touch target gap** |
| `md` | 12px | Internal card padding unit |
| `lg` | 18px | Default gap (`--sk-gap`), section margins |
| `xl` | 24px | Card separation, section padding |
| `xxl` | 36px | Page-level section breaks |

### 8.4 Touch / click target

**Minimum 44px for all interactive elements** — buttons, inputs, nav items, icon buttons — on every screen, touch or not. Matches the `--sk-touch` token.

Touch-designated screens raise this to 48px (§12).

---

## 9. Settings and RBAC in the interface

**Settings decides whether a capability is enabled. RBAC decides who may use it.**

| Condition | Interface behaviour |
|---|---|
| Feature disabled in Settings | Hidden entirely — nav item, badges, related actions |
| Feature enabled, user lacks permission | Hidden entirely |
| Feature enabled, user has permission | Rendered normally |
| Permission is contextual (e.g. session-dependent) | Rendered but disabled, with a plain-language reason |

- **Hide, do not tease.** No greyed-out items for capabilities a user can never access.
- **Empty groups disappear** — including the heading.
- **Badges obey permissions.** A count is data.
- **Unauthorised navigation redirects silently to the dashboard** — do not surface an error alert (v1 rule, retained).
- **Hiding is never the security control.** Every protected operation is authorised at the `SECURITY DEFINER` boundary regardless of what the UI shows.

---

## 10. Theming behaviour

| Concern | Rule |
|---|---|
| Default theme | Light |
| Persistence | Per user, in application settings, restored on launch |
| Switching | Instant, no reload, no flash |
| Initial paint | Theme applied **before first paint** — no light flash in dark mode |
| Coverage | Full. Never a light section inside a dark page. |
| Accent scope | Identical in both themes; derived tokens recompute against the active surface |
| System preference | May be offered as a third option; an explicit user choice always wins |

---

## 11. Accessibility & Inclusive Use

Three overlapping concerns: formal accessibility, fitness for long daily shifts, and fitness for staff with no IT background — including older users meeting a computer interface for the first time.

### 11.1 Accessibility floor

Mandatory for every shipped screen.

| Rule | Standard |
|---|---|
| Text contrast (body) | WCAG AA: 4.5:1 minimum |
| Text contrast (large ≥18px, or 14px bold) | WCAG AA: 3:1 minimum |
| Interactive element contrast | WCAG AA: 3:1 against adjacent background |
| Custom accent colours | Validated per §4.4 before acceptance |
| Keyboard navigation | All interactive elements reachable by Tab / Shift-Tab |
| Focus ring | Visible: 3px solid, offset 1px, accent-tinted. Never removed without equivalent replacement. |
| Screen reader | `aria-label` on icon-only buttons; `aria-live` on dynamic regions |
| Motion | `prefers-reduced-motion: reduce` → transitions 0ms or 1ms |
| Forms | Every input has `<label>` with matching `for`/`id`; errors via `role="alert"` |
| Tables | `<th scope="col">` on all column headers; `aria-sort` on sortable columns |
| Colour independence | No state communicated by colour alone |
| Shortcuts | Every keyboard shortcut has an equally discoverable on-screen equivalent. `Ctrl + K` is never the only path to search. |

Contrast is verified against **rendered output in WebView2 on Windows**, not design-tool previews.

### 11.2 Reading comfort for 8-hour daily use

| Requirement | Specification |
|---|---|
| Minimum body text | **16px** (`body-lg`). Density comes from spacing and layout, never from shrinking text. |
| User text scale | **Paramètres → Apparence → Taille du texte** (Normal / Grand / Très grand) applies a proportional multiplier to the whole type scale. Independent of OS zoom, which WebView2 does not reliably honour. |
| Tabular numerals | Mandatory (§5.3). |
| Auto-refreshing values | KPI figures and live counters must never visually jump. Cross-fade or increment. Sudden numeric jumps repeatedly pull involuntary attention across a shift. |
| Sustained brightness | Warm neutral surfaces in both themes. Stark `#ffffff` as a dominant fill and pure black both increase perceived glare under fluorescent retail lighting over many hours. |
| Dark mode | A fatigue tool, not a cosmetic option. Must be as functionally complete as light mode — never a partial implementation. |
| Motion budget | 200ms cap for state changes, 300ms for modal open/close. No decorative animation. |

### 11.3 Non-technical and older users

| Requirement | Specification |
|---|---|
| Plain-language copy | Everyday business language. No jargon, no raw error codes, no stack traces, no SQL or Rust messages. Every error states what happened and what to do next, in one short sentence. |
| Confirmation wording | State the concrete consequence: *"Cette vente sera annulée et ne pourra pas être récupérée."* — not *"Confirmer ?"*. A yes/no question without a stated consequence is not a real confirmation. |
| One primary path | One obvious next action per screen, not several competing ones. |
| No unexplained icons | Every icon-only control carries a visible label or an accessible tooltip. Icon-only controls are never the sole route to a common action. |
| First-encounter guidance | A brief, dismissible, one-time per-role explanation of what a screen does and its primary action. Never blocking, never repeated once dismissed. Full onboarding flows remain out of scope. |
| Simple mode | A Settings/RBAC-driven mode reducing a screen to fewer metrics, larger controls, and a single clear flow. Suggested default for the `Cashier` role, changeable by an Admin. A genuine accommodation, not a lesser product. |
| Frequent-action targets | Constantly-used primary actions meet the touch minimum even on non-touch screens — larger targets reduce missed clicks for users with less precise motor control. |

---

## 12. Touch-friendly interaction standard

Stockiha's POS station is a **touchscreen monitor with mouse and keyboard also available**. Any screen whose primary task requires little or no keyboard typing — **Point de Vente** is the clearest case, and any future screen matching that low-typing, high-frequency profile inherits this by profile, not by exception — is designed to this standard first, with mouse and keyboard as a fully working fallback.

| Requirement | Specification |
|---|---|
| Minimum touch target | **48px** on touch-designated screens (44px remains the floor everywhere else, §8.4) |
| Target spacing | Minimum **8px** between adjacent targets, to prevent mis-taps on dense grids |
| No hover-dependent actions | Nothing critical depends on `:hover`. Touch has no hover. Hover-only tooltips need a tap or always-visible equivalent. |
| Hit area ≥ glyph | A small icon or link-style action still carries a full-size tappable box around it |
| Large primary action | The screen's primary action uses `button-touch-primary` (64px) — clearly larger than administrative buttons |
| Numeric entry | Prefer large on-screen numeric keypads over the physical keyboard for quantity and amount entry. Routine sales should not require reaching for a keyboard. |
| Gesture independence | No functionality depends on pinch, swipe-to-delete, or other multi-touch gestures without a visible single-tap alternative. Gestures are undiscoverable for first-time and older users and must never be load-bearing. |
| Pressed feedback | Every tappable element shows an immediate visible pressed state — distinct from hover/focus — so the user knows the tap registered and the screen is not frozen |
| Accidental input | Irreversible actions on touch-primary screens require a deliberate confirmation (§7.11, worded per §11.3). Touch has a higher accidental-activation rate than a mouse. |

This is a **standard, not a layout.** The Point de Vente screen's actual design belongs to **WS-F** and requires its own design pass — but that pass builds on these requirements rather than starting from zero.

---

## 13. RTL / internationalisation

Stockiha renders in EN (LTR), FR (LTR), and AR (RTL). `<html>` carries `dir="rtl"` for the `ar` locale.

1. **Logical properties everywhere.** `margin-inline-start`, `padding-inline-end`, `border-inline-start`, `inset-inline-start`. Physical `margin-left`, `padding-right`, `left`, `right` are **banned** in shared component CSS.
2. **Arabic typography:** use the `arabic-body` token (line-height 1.65). Arabic connected script is taller than Latin at the same point size.
3. **Icon mirroring:** directional icons (arrows, chevrons, breadcrumbs) flip via `transform: scaleX(-1)` on `[dir="rtl"]`. Non-directional icons (search, bell, printer) do not.
4. **Active nav indicator:** 3px accent rule via `inset-inline-start`.
5. **Number rendering:** amounts and dates come from the backend as formatted strings. Do not format in the frontend. Numbers, currency, and document references remain LTR inside RTL text.
6. **Text alignment:** inherits from `dir`. Never force `text-align: left` on containers.
7. **Form fields:** labels above inputs in all locales — direction-neutral.
8. **Shell:** the grid is direction-aware; the sidebar renders inline-start, which resolves to the right in AR.

---

## 14. Migration sequence

1. **Tokens first.** Update `src/styles/global.css` to the v2 values and add the derived accent variables. Nothing else changes yet.
2. **Accent engine.** Implement derivation and the contrast guard (§4). Wire Settings → Apparence and the topbar swatch to the **same** stored value — two code paths for one setting is a defect.
3. **Shell.** Sidebar grouping, badges, context bar, KPI strip, context rail, status bar.
4. **Screens, one at a time.** Appearance changes must not alter behaviour, data contracts, or authorisation.
5. **Accessibility pass.** Text scale setting, Simple mode, plain-language error copy.
6. **Touch pass.** WS-F, on the standard in §12.

**Rules throughout:** no component hardcodes a colour, spacing value, radius, or font size — if a value has no token, add the token. Do not rewrite working functionality to change its appearance.

---

## 15. Do's and Don'ts

### Do
- Use `rounded.sm` (8px) for interactive controls; `rounded.md` (12px) for containers.
- Apply `font-feature-settings: "tnum"` to all financial amounts, quantities, and numeric columns.
- Use logical CSS properties everywhere. Ban physical `left`/`right` in shared components.
- Provide full interactive states: default, hover, active, focus-visible, disabled, loading skeleton, empty state, error.
- Apply `min-height: 44px` to every clickable target — 48px on touch-designated screens.
- Keep the sidebar a **visibly distinct surface** from the content area in both themes.
- Derive every accent variant from the single stored value; never hand-author one.
- Respect `prefers-reduced-motion` — transitions 0ms when active.
- Confirm irreversible actions with a two-step dialog stating the consequence in plain language.
- Redirect unauthorised users silently to the dashboard — no error alert.
- Use semantic HTML: `<button>` for actions, `<table>` for tabular data, ARIA labels on icon-only buttons.
- Keep all UI text in locale files (`en`, `fr`, `ar`). No hardcoded strings in components.

### Don't
- Don't render a light-mode section inside a dark-mode page, or vice versa.
- Don't use the accent to communicate state, or a semantic colour to communicate "primary".
- Don't hardcode the accent — it is user-configurable and will change at runtime.
- Don't reduce body text below 16px for density. Density is a spacing lever, not a text-size lever.
- Don't make the sidebar and app background near-identical. That fails §3.2.
- Don't add decorative animation. 200ms state changes, 300ms modals.
- Don't use `float` or `position: absolute` hacks for layout — CSS Grid or Flex.
- Don't scatter raw IPC calls inside components — all Tauri `invoke()` calls live in `src/shared/ipc/` gateway files.
- Don't use floating-point arithmetic for displayed financial values — render backend-provided strings as-is.
- Don't show backend error details (Rust errors, SQL messages, stack traces) to cashiers or managers.
- Don't invent a new status colour. Use `ok`, `danger`, `warn`, `info`, `neutral` only.
- Don't use `<div onClick>` for interactive actions — use `<button>`.
- Don't rely on hover or gestures for anything reachable from a touch-designated screen.
- Don't add a sixth button variant, a third font family, or a fourth shadow level without an ADR.

---

## 16. Architecture boundary

This document governs the **visual language only**. For structural decisions:

- **Component file structure:** `frontend-architecture` skill — UI / logic / data / type separation.
- **IPC layer:** all Tauri commands accessed through `src/shared/ipc/` gateway files; never called directly from components.
- **Financial display:** amounts are strings from the backend; never parsed or reformatted in the frontend.
- **State:** component-local `useState` for UI state; IPC results through custom hooks; no global store for financial data.
- **Authoritative logic:** Rust + PostgreSQL. React never decides posting correctness, permission outcome, or inventory validity.

> **Token authority:** tokens in this file are normative. When a CSS variable in `src/styles/global.css` and a token here disagree, update `global.css` to match this file and record the change in git. This file is the source of truth for visual tokens.

---

## 17. Document authority

| Document | Authority |
|---|---|
| [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md) | Product scope, roadmap, workstream priority — **supersedes this file on all scope questions** |
| [`CURRENT_STEP.md`](./CURRENT_STEP.md) | Current execution position |
| [`TASKS.md`](./TASKS.md) | Execution history |
| [`AGENTS.md`](./AGENTS.md) | Engineering rules and invariants |
| **`DESIGN.md`** (this file) | Visual design system and token authority |
| [`old-documents/`](./old-documents/) | Historical only — never current truth |

This document does not authorise work. It defines how authorised work should look.
