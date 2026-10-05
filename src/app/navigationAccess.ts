import type {
  InventoryCapabilities,
  ProcurementCapabilities,
} from '../shared/ipc/dto';
import type { CustomerCapabilities } from '../shared/ipc/customerDto';
import type { ReportsCapabilities } from '../shared/ipc/reportsDto';
import type { AppView } from './AppShell';

export interface NavAccess {
  inventoryCapabilities: InventoryCapabilities | null;
  inventoryCorrectionsEnabled: boolean | null;
  procurementCapabilities: ProcurementCapabilities | null;
  customerCapabilities: CustomerCapabilities | null;
  reportsCapabilities: ReportsCapabilities | null;
}

/**
 * Authoritative single visibility check shared between the AppShell navigation
 * sidebar and the dashboard quick-actions / KPI links (N-2.2).
 *
 * UI HIDING IS NOT AUTHORISATION: Every one of these capability flags is a
 * best-effort projection for usability; backend commands validate roles with
 * PostgreSQL SECURITY DEFINER.
 */
export function isNavViewVisible(view: AppView, access: NavAccess): boolean {
  switch (view) {
    case 'products':
    case 'catalogueSetup':
      return access.inventoryCapabilities?.can_manage_catalog ?? false;
    case 'inventory':
      return access.inventoryCapabilities?.can_view_inventory ?? false;
    case 'stock':
      return access.inventoryCapabilities?.can_post_stock_receipt ?? false;
    case 'adjustment':
      return (
        (access.inventoryCapabilities?.can_manage_inventory ?? false) &&
        access.inventoryCorrectionsEnabled === true
      );
    case 'suppliers':
    case 'purchases':
      return access.procurementCapabilities?.can_manage_procurement ?? false;
    case 'customers':
      return access.customerCapabilities?.can_view_customers ?? false;
    case 'reports':
      return access.reportsCapabilities?.can_view_reports ?? false;
    default:
      return true;
  }
}
