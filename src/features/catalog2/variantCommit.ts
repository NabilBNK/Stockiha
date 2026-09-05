/**
 * WS-D-11B — the ONE place that assembles an `updateVariantV2` payload.
 *
 * THE OVERWRITE TRAP. `catalog.update_variant` assigns `name_override`,
 * `sale_price`, `is_active` and `minimum_stock` unconditionally — a commit
 * that sent only the touched column would blank the other three. Both the
 * table's inline cells (`useCatalogList.commitVariantField`) and the panel's
 * fields (`CatalogPanel.commitVariant`, used by `VariantEditor`'s price and
 * minimum-stock cells) call this ONE function to build that payload and make
 * the write, so the two surfaces cannot build it differently — there is
 * exactly one place this decision is made, not two that could drift apart.
 *
 * `patch.x !== undefined` distinguishes "the user did not touch this column"
 * from an explicit falsy value (`null` name override, `false` active). `??`
 * would be wrong here — it would make clearing a name override or setting
 * `is_active: false` impossible to express as a deliberate change.
 */
import * as ipc from '../../shared/ipc/gateway';

/** The four columns `update_variant` assigns, as they currently stand. */
export interface VariantFieldSnapshot {
  name_override: string | null;
  sale_price: string;
  is_active: boolean;
  minimum_stock: string;
}

/** Only the columns actually being changed by this commit. */
export interface VariantFieldPatch {
  nameOverride?: string | null;
  salePrice?: string;
  isActive?: boolean;
  minimumStock?: string;
}

export function commitVariantFields(
  token: string,
  variantId: number,
  snapshot: VariantFieldSnapshot,
  patch: VariantFieldPatch,
): Promise<void> {
  return ipc.updateVariantV2(
    token,
    variantId,
    patch.nameOverride !== undefined ? patch.nameOverride : snapshot.name_override,
    patch.salePrice !== undefined ? patch.salePrice : snapshot.sale_price,
    patch.isActive !== undefined ? patch.isActive : snapshot.is_active,
    patch.minimumStock !== undefined ? patch.minimumStock : snapshot.minimum_stock,
  );
}
