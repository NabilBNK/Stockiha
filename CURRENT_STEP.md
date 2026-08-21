# Current Step

> **Execution tracker, not product/roadmap authority.**
>
> The only current product/roadmap ground-truth document is [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md). Use this file for the **current execution step**; use the ground truth for MVP scope, Workstream priorities, feature boundaries, health scores, and deferred scope.
>
> Actual implementation behavior is established by reproducible runtime behavior, current source code, applied migrations, automated tests, and verified Windows/Tauri evidence. If this tracker conflicts with implementation evidence, implementation evidence wins for what actually works.

## Current execution position

Stockiha is in **MVP completion / stabilization under deadline pressure**. The goal is to complete the pillar features as quickly and safely as possible without sacrificing accounting, inventory, permission, security, or data-integrity correctness.

The MVP flow is:

**Setup → Authentication → Users/RBAC → Products → Inventory → Purchases → POS/Sales → Cash Sessions → Customers/Credit → Financial Accounting → Settings → Backup/Recovery → Basic Reports + Historical Financial Import**

## Priority execution order

1. **WS-A — Foundation & Access**
   - User Management
   - Authentication
   - RBAC
   - Admin role/access management
   - Custom users created by SuperAdmin
   - Permission enforcement

2. **WS-B — Financial Core**
   - Core accounting engine
   - Journals / ledger integrity
   - AR/AP
   - Cash / Bank
   - Inventory valuation / WAC foundation
   - Transaction-to-accounting correctness

3. **WS-C — Settings & Policy Engine**
   - Backend + frontend redesign
   - Feature toggles
   - Business-policy configuration
   - Tax ON/OFF configuration for future tax support
   - Stock-transfer toggle
   - Discount configuration
   - Valuation-policy configuration (WAC/FIFO/etc.)
   - Role/RBAC management configuration
   - Persistent, backend-enforced settings

4. **WS-D — Product & Inventory Core**
   - Product/catalog backend and UI/UX revision
   - Product variants and identifiers
   - Barcode-first lookup globally
   - Inventory MVP, including required inventory analytics
   - Stock correction
   - Serious stock-transfer testing

5. **WS-E — Procurement & Supplier Operations**
   - Direct Purchase is the current MVP purchasing workflow
   - Purchase page enhancement
   - Purchase history
   - Supplier returns/details
   - Procurement/accounting integration
   - Broader purchase-order/purchase-policy expansion is future scope

6. **WS-F — POS, Sales & Cash Operations**
   - POS revision
   - Cash Session revision
   - Product/barcode lookup
   - Payments
   - Customers/credit
   - Discounts as configurable/manual capability, but not currently a priority

7. **WS-G — Historical Financial Import**
   - Current condition: **5/10**
   - Column mapping is working
   - Remaining validation, workflow, testing, and reliability improvements
   - Historical data starts isolated and must not silently modify live operational ledgers

8. **WS-H — Backup & Recovery**
   - Current implementation is **not trusted / not working reliably**
   - Manual backup
   - Restore
   - Backup validation
   - Database consistency verification
   - Database health verification

9. **WS-I — Reporting & Analytics**
   - Important MVP capability
   - Comes after the pillar features so reports can be built on stable business/accounting data
   - Sales, purchases, inventory, customer/supplier balances, profit, cash and related reports
   - Filtering and export/print requirements

10. **WS-J — Dashboard & Application UX**
    - Full dashboard redesign after pillar features stabilize
    - Role-specific dashboard
    - Sidebar redesign
    - Topbar redesign
    - Element placement/layout redesign
    - Consistent feature visibility based on Settings + RBAC

11. **WS-K — Windows/Tauri Acceptance & Release**
    - **Top-priority release gate**
    - Exact-candidate Windows/Tauri validation
    - Production build / launch verification
    - End-to-end MVP journeys
    - Regression and persistence checks
    - No unexplained accounting/inventory/data-integrity variance

12. **WS-L — Audit & Compliance**
    - Deliberately placed late
    - Implement after most pillar features and workflows are stable
    - Audit important business, administrative, security, settings, inventory, sales, procurement, payment, import, and recovery actions

## Current health snapshot

| Area | Current condition |
|---|---:|
| Product backend | **6.5/10** |
| Product frontend / UI/UX | **4/10** |
| Barcode-first global search | **5/10** |
| Procurement / Purchase page | **6/10** |
| Direct Purchase | **Good; needs a small confidence test + minor refinement** |
| Historical financial import | **5/10** |
| POS | **Needs serious revision/testing** |
| Cash Session | **Needs serious revision/testing** |
| Stock transfers | **Untrusted until seriously tested** |
| Backup / Recovery | **Currently not working reliably; needs repair + testing** |
| Dashboard | **Requires full redesign later** |
| Sidebar / Topbar | **Requires redesign later** |
| Settings | **Critical; requires frontend + backend redesign** |
| User Management / RBAC | **Critical / immediate priority** |
| Financial Core | **Critical** |
| Reporting | **Important; enhancement follows pillar-feature completion** |
| Audit Trail | **Deferred until late roadmap** |

## Stockiha policy: Settings + RBAC

A core Stockiha policy is that **all possible optional business features must be configurable/toggleable from Settings**.

Examples include:

- tax enable/disable;
- stock transfers enable/disable;
- discounts enable/disable/configuration;
- inventory valuation policy such as WAC/FIFO where supported;
- feature availability;
- role configuration;
- RBAC permissions;
- other business-policy switches introduced by the product.

Settings determines **whether/how a capability is enabled**. RBAC determines **which users/roles can use it**. Both frontend visibility and backend authorization must respect these policies.

Default roles are **SuperAdmin, Admin, Manager, and Cashier**. Custom users can be created by SuperAdmin. Admins can modify role access according to the permission model defined by the product.

## Financial integrity rule

Business workflows should normally be considered complete only when their financial consequences are correct.

Sales, purchases, returns, payments, inventory adjustments, and related operations must preserve accounting, inventory, document, and retry/idempotency invariants. TVA/tax is future work for now; the system must not invent tax behavior.

## Deferred / future scope

- Payroll.
- TVA / tax accounting implementation.
- Product images.
- Broader advanced procurement policies beyond Direct Purchase.
- Non-MVP advanced inventory capabilities beyond the defined inventory-MVP analytics.
- Advanced reporting/analytics beyond the MVP reporting requirement.
- Advanced backup scheduling/off-device/encrypted retention unless later promoted.
- Other features explicitly marked future/deferred in `STOCKIHA_GROUND_TRUTH.md`.

## Execution rules

- Do not expand scope because an old roadmap mentions an obsolete PR/R/S number.
- Do not use documents under `old-documents/` as current planning authority.
- Use `WS-A` through `WS-L` terminology for new planning and task references.
- Prioritize critical pillar work over cosmetic redesigns unless the redesign blocks a pillar workflow.
- Do not declare a feature complete from code existence alone; verify it.
- Windows/Tauri acceptance remains a release-critical gate.
- Because the project has a deadline, prefer small, complete, testable increments and avoid speculative architecture.

## Completion definition

The MVP is complete when the defined pillar workflows operate end-to-end with correct permissions, settings policies, financial/inventory integrity, persistence, backup/recovery behavior, and Windows/Tauri acceptance, with basic reporting and historical financial import at their required MVP boundary and no known release-blocking defects.
