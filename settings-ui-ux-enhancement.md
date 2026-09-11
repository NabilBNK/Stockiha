# Settings Page UI/UX Enhancement Plan

## 1. Overview
Enhance the visual design, layout, spacing, borders, buttons, and interaction quality of the Stockiha Settings surface (`DrawerPolicySettingsScreen`, `InventoryCorrectionsSettingsScreen`, `RecoverySettingsScreen`, and `UserManagementSettingsScreen`).

## 2. Design Read & Principles
- **Design Read**: Desktop ERP system settings for business operators and administrators, with a clean, high-clarity Linear/Tailwind-style language, leaning toward Stockiha's existing warm palette (`DESIGN.md` v2 / `global.css`) with refined card geometry, elegant toggle cards, and proportional button hierarchy.
- **Dials**:
  - `DESIGN_VARIANCE: 5` (Structured, consistent, professional)
  - `MOTION_INTENSITY: 3` (Subtle, responsive micro-interactions)
  - `VISUAL_DENSITY: 5` (Balanced desktop data density)

---

## 3. UI/UX Problem Diagnosis & Solutions

### A. Fragmented Page Headers & Structure
- **Current Issue**: Four separate screens are stacked vertically, each rendering independent `<section className="sk-page">` tags with duplicate headers, irregular margins, and inconsistent visual hierarchy.
- **Solution**:
  - Introduce a unified settings container or tabbed navigation / clean anchor structure with a single primary page title and clear section descriptions.
  - Consistent vertical rhythm (`gap: 24px` between cards).

### B. "Cash Drawer Eligibility" & "Inventory Corrections" Checkboxes
- **Current Issue**: Raw, unstyled blue browser checkboxes in an uneven 3-column wrap with awkward "Enabled" pill badges directly under the label text.
- **Solution**:
  - Transform each operation into a modern interactive **Toggle Card**:
    - Clean card surface with subtle border (`var(--sk-border)`), soft hover tint, and active border accent (`var(--sk-primary)`).
    - Modern CSS switch toggle on the right or embedded toggle indicator.
    - Clear title, secondary helper text, and subtle status badge.
    - Responsive grid (`repeat(auto-fill, minmax(280px, 1fr))`).

### C. Action Buttons & Card Header Layout
- **Current Issue**: "Create user" and "Create role" buttons are large blue buttons floating alone in empty space above tables with awkward left/top margins.
- **Solution**:
  - Integrate action buttons directly into the **Card Header**:
    - Left: Section title (`h2`) + concise descriptive text.
    - Right: Primary action button (`Create user`, `Create role`).
    - Creates standard, polished dashboard layout (aligned with Linear, Stripe, and modern enterprise ERPs).

### D. Table Row Action Buttons & Typography
- **Current Issue**: Table rows have oversized 44px buttons (`[ Change role ]`, `[ Deactivate ]`, `[ Edit permissions ]`) that wrap awkwardly via `.sk-stack`, blowing up table row height.
- **Solution**:
  - Use compact table action buttons (`.sk-button--small` / 32px height).
  - Wrap in `.sk-action-group` (`display: inline-flex; gap: 8px; justify-content: flex-end`).
  - Subtle secondary border and hover states (`--sk-surface-hover`).
  - Refined danger button for "Deactivate" (subtle danger border/tint, avoiding harsh heavy blocks).
  - Clean role badges with soft semantic colors.

### E. Backup & Recovery Section Polish
- **Current Issue**: File pickers and validate buttons are misaligned with inconsistent borders and button heights.
- **Solution**:
  - Group backup creation, folder selection, and verification into cohesive, structured sub-cards with matching input heights and clean action alignment.

---

## 4. Scope & Impact
- **In-Scope**:
  - Front-end styling (CSS, layout, button components, toggle cards, card headers, tables, badges, spacing, borders).
  - Dark mode and RTL compatibility.
  - Preserving 100% of existing `data-testid` attributes and IPC calls.
- **Out-of-Scope**:
  - Backend Rust code, SQL schemas, migrations, PostgreSQL functions, authentication/permissions logic.
- **Database & Security Impact**:
  - **Zero impact**. No queries, schemas, or security boundaries modified.

---

## 5. Files Expected to Change
1. `src/features/settings/settings.css` (NEW: Dedicated settings styling)
2. `src/features/settings/DrawerPolicySettingsScreen.tsx` (Toggle card grid & clean header)
3. `src/features/settings/InventoryCorrectionsSettingsScreen.tsx` (Refined toggle card)
4. `src/features/settings/UserManagementSettingsScreen.tsx` (Card header actions, compact table buttons, action group)
5. `src/features/settings/RecoverySettingsScreen.tsx` (Action alignment and spacing polish)
6. `src/styles/global.css` (Import settings.css or shared toggle-card styles)

---

## 6. Verification Plan
- `npm run typecheck` (ensure TypeScript passes with 0 errors)
- `npm test tests/user-management-permissions.workflow.test.tsx` (ensure all tests pass)
- Browser / manual inspection of layout, buttons, margins, borders, dark theme, and RTL.
