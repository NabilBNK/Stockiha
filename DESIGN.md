---
version: "1.0.0"
name: Stockiha
description: >
  Single-company, single-store Windows desktop ERP (Tauri v2 + React 19).
  Supports EN / FR / AR with RTL layout. Operational product — cashiers, managers,
  administrators. Data-dense, trust-first, accessibility-critical.

colors:
  # Backgrounds
  bg: "#f4f7fb"
  surface: "#ffffff"
  surface-soft: "#f8fafc"
  surface-hover: "#f3f6fb"

  # Borders
  border: "#dce3ec"
  border-strong: "#c8d2df"

  # Text
  text: "#172033"
  text-soft: "#37445a"
  muted: "#637083"

  # Brand / Primary (Cobalt Blue)
  primary: "#2457d6"
  primary-hover: "#1948bd"
  primary-soft: "#edf3ff"

  # Navigation sidebar (Deep Navy)
  nav: "#111b33"
  nav-soft: "#1b2947"
  nav-active: "#2c5bd3"
  nav-active-accent: "#7ea5ff"
  nav-text: "#cbd4e7"
  nav-text-muted: "#8492ae"

  # Semantic status
  danger: "#c0393f"
  danger-soft: "#fff0f0"
  ok: "#16815d"
  ok-soft: "#eaf8f2"
  warn: "#a2630b"
  warn-soft: "#fff6df"
  info-soft: "#edf3ff"

  # Dark theme overrides (resolved at [data-theme="dark"])
  dark-bg: "#0b1220"
  dark-surface: "#111b2d"
  dark-surface-soft: "#162238"
  dark-surface-hover: "#1b2a42"
  dark-border: "#27364d"
  dark-border-strong: "#384a65"
  dark-text: "#e8eef8"
  dark-text-soft: "#c4d0e2"
  dark-muted: "#93a4bd"
  dark-primary: "#6f98ff"
  dark-primary-hover: "#88aaff"
  dark-primary-soft: "#172c57"
  dark-nav: "#070d18"
  dark-nav-soft: "#14223a"
  dark-danger: "#ff7b82"
  dark-danger-soft: "#391d25"
  dark-ok: "#54d2a3"
  dark-ok-soft: "#15352e"
  dark-warn: "#f2ba62"
  dark-warn-soft: "#3b2b14"

typography:
  headline-display:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.55rem, 2vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline-lg:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.22rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  headline-md:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.35
  body-lg:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  body-md:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.4
  label-lg:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 700
    lineHeight: 1.2
  label-md:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.035em"
    fontFeature: "tnum"
  label-sm:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 750
    lineHeight: 1.1
    letterSpacing: "0.09em"
  metric-value:
    fontFamily: "Segoe UI, Inter, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2rem, 3vw, 2.65rem)"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "tnum"
    fontVariation: "numeric tabular"
  arabic-body:
    fontFamily: "Noto Kufi Arabic, Cairo, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65

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

components:
  # Shell
  shell-header:
    height: "70px"
    backgroundColor: "{colors.surface}"
    padding: "0 22px"
  shell-nav:
    width: "248px"
    widthCollapsed: "76px"
    backgroundColor: "{colors.nav}"
    padding: "18px 12px 28px"
  shell-main:
    backgroundColor: "{colors.bg}"
    padding: "clamp(20px, 2.5vw, 36px)"
    maxWidth: "1380px"

  # Navigation items
  nav-item:
    minHeight: "43px"
    padding: "7px 11px"
    rounded: "{rounded.sm}"
    backgroundColor: "transparent"
    textColor: "{colors.nav-text}"
  nav-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "#ffffff"
    fontWeight: 700
  nav-item-hover:
    backgroundColor: "{colors.nav-soft}"
    textColor: "#ffffff"

  # Cards
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "20px"
    border: "1px solid {colors.border}"
  metric-card:
    backgroundColor: "{colors.surface-soft}"
    rounded: "{rounded.md}"
    minHeight: "142px"
    padding: "22px"

  # Buttons
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 17px"
    minHeight: "44px"
    fontWeight: 700
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px 17px"
    minHeight: "44px"
    border: "1px solid {colors.border}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 17px"
    minHeight: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.sm}"
    padding: "8px 17px"
    minHeight: "44px"

  # Inputs
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
    minHeight: "44px"
    border: "1px solid {colors.border-strong}"
  input-focus:
    border: "1px solid {colors.primary}"
  input-small:
    width: "110px"
    minHeight: "38px"

  # Badges
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
  badge-info:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
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
  table-row-hover:
    backgroundColor: "{colors.surface-hover}"

  # Icon buttons
  icon-button:
    width: "40px"
    height: "40px"
    rounded: "10px"
    backgroundColor: "{colors.surface-soft}"
    border: "1px solid {colors.border}"
  metric-icon:
    width: "42px"
    height: "42px"
    rounded: "12px"
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"

  # Logo mark
  brand-logo:
    width: "38px"
    height: "38px"
    rounded: "11px"
    backgroundColor: "linear-gradient(145deg, #3470f4, #1d49be)"
    textColor: "#ffffff"
---

# Stockiha Design System

## Overview

Stockiha is a **single-company, single-store Windows desktop ERP** built with Tauri v2, React 19, and TypeScript. The interface serves three distinct user tiers: cashiers at the POS, store managers overseeing inventory and procurement, and administrators managing configuration and opening state.

**Design personality:** Operational precision. Every pixel earns its place. The interface feels like a professional tool, not a marketing site. Clarity, density, and trust over decoration.

**Audience:**
- **Cashiers:** speed and clarity at POS; zero tolerance for ambiguous states.
- **Managers:** data density with clear hierarchy; quick scanning over deep reading.
- **Administrators:** control and auditability; progressive disclosure for destructive actions.

**Locale support:** EN (LTR), FR (LTR), AR (RTL). All layout, spacing, and directional rules must be logical (inline/block), never physical (left/right). All tokens use CSS `direction: rtl` inheritance automatically via the `[dir="rtl"]` attribute on `<html>`.

**Theme:** Light (default) and Dark. Both themes are full-coverage — no light sections inside a dark page or vice versa. Theme is set once at the document root via `[data-theme="dark"]`.

**Aesthetic family:** Enterprise-clean / functional precision. Comparable to Linear's operational density but for a native Windows desktop context. No frosted glass, no centred hero sections, no illustration-heavy empty states.

**Design Dials (contextual):**
- `DESIGN_VARIANCE: 5` — structural consistency with targeted intentional variation
- `MOTION_INTENSITY: 3` — functional micro-transitions only; no decorative animation
- `VISUAL_DENSITY: 8` — data-dense; card-heavy layouts with tight spacing

---

## Colors

### Brand Palette

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `primary` | `#2457d6` | `#6f98ff` | Actions, links, focus rings, active states |
| `primary-hover` | `#1948bd` | `#88aaff` | Button hover |
| `primary-soft` | `#edf3ff` | `#172c57` | Icon backgrounds, badge fills, soft highlights |

**Rationale:** Cobalt Blue (`#2457d6`) reads as reliable, precise, and institutional — appropriate for a financial tool. It passes WCAG AA on white and dark-navy backgrounds. The dark-mode adaptation (`#6f98ff`) maintains the same hue family at a lighter value for contrast on near-black surfaces.

### Surface Palette

The light theme uses a cool-off-white base (`#f4f7fb`) that gives the interface a slight blue-grey cast, harmonising with the cobalt primary. Surfaces step from `bg → surface → surface-soft`, creating a three-level elevation language without shadows.

The dark theme uses a deep navy base (`#0b1220`) — not pure black — which keeps eye strain low during long shifts and matches the sidebar's `#111b33`.

### Semantic Status Colors

Status colors communicate financial and operational outcomes. They must never be used decoratively.

| State | Light fg | Light bg | Dark fg | Dark bg | Use |
|-------|----------|----------|---------|---------|-----|
| OK / success | `#16815d` | `#eaf8f2` | `#54d2a3` | `#15352e` | Confirmed, posted, open session |
| Danger / error | `#c0393f` | `#fff0f0` | `#ff7b82` | `#391d25` | Failed, overdrawn, rejected |
| Warning | `#a2630b` | `#fff6df` | `#f2ba62` | `#3b2b14` | Pending approval, low stock |
| Info | `primary` | `primary-soft` | `dark-primary` | `dark-primary-soft` | Neutral informational banners |

### Navigation Sidebar

The sidebar uses a separate deep-navy palette (`#111b33` base) that is **theme-independent** — it appears the same in both light and dark mode. This creates a stable orientation anchor across theme switches.

- Active item: `#2c5bd3` fill with a `#7ea5ff` left accent rule (3 px).
- Hover: `#1b2947` fill, text lifts to `#ffffff`.
- Default item text: `#cbd4e7`; group labels: `#8492ae`.

---

## Typography

### Font Stack

```
"Segoe UI", Inter, system-ui, -apple-system, "Noto Kufi Arabic", Cairo, sans-serif
```

**Rationale:** Segoe UI is the native Windows system font — it renders at device pixel density with ClearType hinting, zero flash-of-unstyled-text, no network request. Inter follows as a web fallback. Arabic text uses Noto Kufi Arabic or Cairo, both of which support connected script forms required for AR content in a commercial context.

**No serif fonts.** This is an operational tool; serif type would introduce editorial character that conflicts with the trust-first and data-dense requirements.

### Type Scale

| Token | Size | Weight | Use |
|-------|------|--------|-----|
| `headline-display` | `clamp(1.55rem, 2vw, 2rem)` | 700 | `<h1>` — page title |
| `headline-lg` | `1.22rem` | 700 | `<h2>` — section heading |
| `headline-md` | `1.05rem` | 700 | `<h3>` — card heading |
| `body-lg` | `15px` | 400 | Default body, table rows |
| `body-md` | `0.88rem` | 400 | Secondary body, descriptions |
| `body-sm` | `0.82rem` | 400 | Captions, helper text, timestamps |
| `label-lg` | `0.82rem` | 700 | Form labels |
| `label-md` | `0.78rem` | 700 | Table column headers, metric labels (`tnum`) |
| `label-sm` | `0.68rem` | 750 | Nav group labels, eyebrows (uppercase, `+0.09em`) |
| `metric-value` | `clamp(2rem, 3vw, 2.65rem)` | 800 | Dashboard KPI numbers (`tnum`) |
| `arabic-body` | `15px` | 400 | Body text when `lang="ar"` (line-height 1.65) |

**Tabular numerals (`tnum`) are mandatory** for all financial amounts, quantities, dates, and document numbers. Values must not cause column reflow as they update.

---

## Layout

### Application Shell

The shell is a two-row, two-column CSS Grid:

```
┌─────────────────────────────────────┐
│ Header (70px, full width)           │
├──────────────┬──────────────────────┤
│ Nav sidebar  │ Main content area    │
│ 248px        │ minmax(0, 1fr)       │
│ (76px if     │ overflow: auto       │
│ collapsed)   │ padding: clamp(…)   │
└──────────────┴──────────────────────┘
```

- **Header:** `background: surface`, `border-bottom: 1px solid border`. Brand mark (left), actions and user indicator (right).
- **Sidebar:** `background: nav` (deep navy, theme-independent). Collapses to icon-only mode at 76px.
- **Main:** `background: bg`. Max content width `1380px`, centered with `margin-inline: auto`.
- **RTL:** Grid is direction-aware — sidebar renders on the right in AR locale via CSS logical properties.

### Grid System

All multi-column layouts use **CSS Grid**, never percentage flex math.

| Pattern | Grid definition | Use |
|---------|----------------|-----|
| Auto-fit cards | `repeat(auto-fit, minmax(210px, 1fr))` | Metric cards, product grids |
| Dashboard split | `minmax(0, 1.35fr) minmax(300px, 0.65fr)` | Catalog / operations two-pane |
| Activity grid | `minmax(220px, 1.35fr) repeat(3, minmax(150px, 1fr))` | Dashboard activity row |
| Form grid | `repeat(auto-fit, minmax(210px, 1fr))` | Two-column form fields |

### Spacing Scale

| Token | Value | Use |
|-------|-------|-----|
| `xs` | 4px | Badge padding, tight gaps |
| `sm` | 8px | Icon gaps, input padding unit |
| `md` | 12px | Internal card padding unit |
| `lg` | 18px | Default gap (`--sk-gap`), section margins |
| `xl` | 24px | Card separation, section padding |
| `xxl` | 36px | Page-level section breaks |

### Touch / Click Target

**Minimum 44px** for all interactive elements (buttons, inputs, nav items). Matches the `--sk-touch` token.

---

## Elevation & Depth

Stockiha uses a **border-first elevation language**, not shadow-first. Shadows supplement; they never replace a border.

| Level | Definition | Use |
|-------|-----------|-----|
| 0 — Flat | `background: bg`, no border | Page background |
| 1 — Soft surface | `background: surface-soft`, `border: 1px solid border` | Metric cards, table rows |
| 2 — Surface | `background: surface`, `border: 1px solid border`, `shadow` | Cards, dropdowns |
| 3 — Elevated | `background: surface`, `shadow-lg` | Modals, popovers |

**Shadow tint rule:** Both shadow tokens use blue-tinted RGBA (`rgba(16, 32, 64, ...)` light; `rgba(0, 0, 0, ...)` dark). Never pure black drop shadows.

---

## Shapes

One corner-radius scale for the entire application. **No mixing.**

| Token | Value | Use |
|-------|-------|-----|
| `none` | 0px | Hard-edge table cells, full-bleed areas |
| `sm` | 8px | Inputs, buttons, small icon containers |
| `md` | 12px | Cards, modals, standard containers |
| `lg` | 18px | Dashboard panels, large feature cards |
| `full` | 9999px | Badges, pills, status chips |

**Shape-consistency lock:** `sm` for interactive controls (buttons, inputs, icon buttons); `md`/`lg` for containers. Mixing these without a documented exception is a layout error.

---

## Components

### Buttons

Four variants. Never invent a fifth.

| Variant | Token | When |
|---------|-------|------|
| `button-primary` | Cobalt fill, white text | The single most important action per screen |
| `button-secondary` | Surface fill, border | Secondary or neutral actions |
| `button-danger` | Danger fill, white text | Destructive actions (delete, void, force-close) |
| `button-ghost` | No fill, no border, muted text | Tertiary, inline, or cancel |

Rules:
- All buttons have `min-height: 44px`.
- Primary CTA label: max 3 words; must fit on one line.
- One primary button per screen section.
- Active state: `transform: scale(0.98)`.
- Focus: `outline: 3px solid color-mix(in srgb, primary 25%, transparent)`.
- Danger actions require a confirm dialog (two-step) when irreversible.

### Form Inputs

- `label-lg` typography above the input. Never as placeholder.
- `min-height: 44px`, `border-radius: sm`.
- Focus: `border-color: primary`, `box-shadow: 0 0 0 3px rgba(primary, 0.13)`.
- Error text below input — `body-sm`, `danger` color.
- Helper text below input (optional) — `body-sm`, `muted` color.
- `input-small` variant (110px wide, 38px tall) for quantity / numeric fields.

### Cards

- `border: 1px solid border` + `shadow` + `border-radius: md`.
- Inner padding: `20px`.
- First `<h2>` child gets `border-bottom: 1px solid border` separator.
- Cards do not nest.

### Metric Cards

Used on Dashboard and reporting screens for KPI display.

- Grid: `grid-template-columns: auto 1fr` / `grid-template-rows: 1fr auto`.
- Icon: 42×42px, `border-radius: 12px`, `background: primary-soft`, `color: primary`.
- Value: `metric-value` typography with `tnum`.
- Label: `label-sm` uppercase, `muted` color.
- `min-height: 142px`.

### Badges / Status Chips

One-word status labels only. No icons inside badges for standard states.

| State | Token |
|-------|-------|
| OK | `badge-ok` |
| Danger | `badge-danger` |
| Warning | `badge-warn` |
| Info | `badge-info` |
| Neutral | `badge-neutral` |

- `border-radius: full` (pill).
- Never use color alone to convey status — always pair with a text label.

### Navigation

- Sidebar items: `label-md` typography for labels; `label-sm` uppercase for group labels.
- Active indicator: 3px inline-start accent rule (`nav-active-accent`) + `nav-active` fill.
- Collapsed mode: icon-only, 46×46px touch target, centered.
- RTL: accent rule on `inline-end` side.

### Tables

- Column headers: `label-sm` uppercase, `muted` color, `surface-soft` background.
- Rows: `body-lg`, `border-bottom: 1px solid border`, `surface` background.
- Row hover: `surface-hover`.
- Financial amounts: `tnum` feature; right-aligned (LTR) / left-aligned (RTL).
- Sticky header on long tables: `position: sticky; top: 0; z-index: 2`.
- Empty state: informative message with action prompt; no blank space.

### Banners

Four tones, inline placement.

| Tone | Fill | Left border | Use |
|------|------|------------|-----|
| `info` | `primary-soft` | 3px `primary` | Informational guidance |
| `success` | `ok-soft` | 3px `ok` | Operation confirmed |
| `warning` | `warn-soft` | 3px `warn` | Pending action needed |
| `error` | `danger-soft` | 3px `danger` | Action failed |

### Toolbar / Page Header

Every list/table screen has a toolbar row:
- Left: page `<h1>` or filter controls (`flex: 1 1 260px`).
- Right: primary action button.
- `margin-bottom: 22px`.
- `flex-wrap: wrap`, `gap: 12px`.

### Modals / Dialogs

- Overlay: `rgba(0, 0, 0, 0.45)`.
- Dialog: `background: surface`, `border-radius: lg`, `shadow-lg`, `max-width: 520px` (wide: `720px`).
- Header: `<h2>` with `border-bottom: 1px solid border`.
- Footer: Cancel (ghost) + Confirm (primary or danger), `justify-content: flex-end`.
- Keyboard: Escape closes; focus trapped inside.

---

## Do's and Don'ts

### Do
- Use `rounded.sm` (8px) for all interactive controls; `rounded.md` (12px) for all containers.
- Apply `font-feature-settings: "tnum"` on all financial amounts, quantities, and numeric columns.
- Use logical CSS properties (`margin-inline-start`, `padding-inline`, etc.) everywhere. Ban physical `left`/`right` in shared components.
- Provide full interactive states: default, hover, active, focus-visible, disabled, loading skeleton, empty state, error.
- Apply `min-height: 44px` to every clickable target.
- Keep the sidebar theme-independent (deep navy in both light and dark mode).
- Respect `prefers-reduced-motion` — set all transition durations to 0ms when active.
- Confirm irreversible actions (posting, voiding, deleting) with a two-step dialog.
- Redirect unauthorized users silently to the dashboard — do not surface error alerts.
- Use semantic HTML: `<button>` for actions, `<table>` for tabular data, ARIA labels on icon-only buttons.
- Keep all UI text in the locale files (`en`, `fr`, `ar`). No hardcoded strings in components.

### Don't
- Don't render a light-mode section inside a dark-mode page, or vice versa.
- Don't substitute the cobalt primary for purple, violet, or AI-gradient aesthetics.
- Don't add decorative animation. Transition duration cap: 200ms for state changes, 300ms for modal open/close.
- Don't use `float` or `position: absolute` hacks for layout — use CSS Grid or Flex.
- Don't scatter raw IPC calls inside components — all Tauri `invoke()` calls live in `src/shared/ipc/` gateway files.
- Don't use floating-point arithmetic for displayed financial values — render backend-provided strings as-is.
- Don't show backend error details (Rust errors, SQL messages, stack traces) to cashiers or managers.
- Don't invent a new status color. Use `ok`, `danger`, `warn`, `info`, `neutral` only.
- Don't use `<div onClick>` for interactive actions — use `<button>`.
- Don't add a sixth button variant, a third font family, or a fourth shadow level without an ADR.

---

## RTL / Internationalisation Rules

Stockiha renders in EN (LTR), FR (LTR), and AR (RTL). The `<html>` element carries `dir="rtl"` when the locale is `ar`.

1. **Logical properties everywhere.** Use `margin-inline-start`, `padding-inline-end`, `border-inline-start`, `inset-inline-start`. Ban `margin-left`, `padding-right`, `left`, `right` in shared component CSS.
2. **Arabic typography:** Use `arabic-body` token (`line-height: 1.65`). Arabic connected script is taller than Latin at the same point size.
3. **Icon mirroring:** Directional icons (arrows, chevrons, breadcrumbs) must flip in RTL via `transform: scaleX(-1)` on `[dir="rtl"]`.
4. **Active nav indicator:** 3px accent rule on `inline-start` side; use `inset-inline-start` in CSS.
5. **Number rendering:** Render amounts and dates via backend-provided formatted strings; do not format in the frontend.
6. **Text alignment:** Body text inherits from `dir`. Do not force `text-align: left` on containers.
7. **Form fields:** Labels sit above inputs in all locales — direction-neutral.

---

## Accessibility Floor

Mandatory for every shipped screen.

| Rule | Standard |
|------|----------|
| Text contrast (body) | WCAG AA: 4.5:1 minimum |
| Text contrast (large ≥18px or 14px bold) | WCAG AA: 3:1 minimum |
| Interactive element contrast | WCAG AA: 3:1 on adjacent background |
| Keyboard navigation | All interactive elements reachable by Tab / Shift-Tab |
| Focus ring | Visible: 3px solid, offset 1px, primary-tinted |
| Screen reader | `aria-label` on icon-only buttons; `aria-live` on dynamic regions |
| Motion | `prefers-reduced-motion: reduce` → transitions 0ms or 1ms |
| Forms | Every input has `<label>` with matching `for`/`id`; errors via `role="alert"` |
| Tables | `<th scope="col">` on all column headers; `aria-sort` on sortable columns |

---

## Architecture Boundary

This DESIGN.md governs the visual language only. For structural decisions, see:

- **Component file structure:** `frontend-architecture` skill — UI / logic / data / type separation.
- **IPC layer:** all Tauri commands accessed through `src/shared/ipc/` gateway files; never called directly from components.
- **Financial display:** amounts are strings from the backend; never parsed or reformatted in the frontend.
- **State:** component-local `useState` for UI state; IPC results go through custom hooks; no global store for financial data.
- **Authoritative logic:** Rust + PostgreSQL. React never decides posting correctness, permission outcome, or inventory validity.

> **Token authority:** Tokens in this file are normative. When a CSS variable in `src/styles/global.css` and a token here disagree, update `global.css` to match this file and record the change in git. This file is the source of truth.
