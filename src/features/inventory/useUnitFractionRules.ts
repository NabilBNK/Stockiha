/**
 * WS-D-13 Phase A — the ONE place the unit catalogue is loaded for
 * decimal-vs-whole checking.
 *
 * `isQuantityValidForUnit` (exactDecimal.ts) is the single validator; this is
 * the single loader that feeds it. Five quantity-entry screens need the same
 * answer — "may this unit carry a fraction?" — and they identify the unit
 * differently: Stock Adjustment and Purchase Transaction hold a `unit_id`,
 * Supplier Returns and Purchase Receipt hold a `unit_code`. Both lookups are
 * served from one `catalog.list_units_v2` call so the five screens cannot
 * drift apart, which is the failure this repository has already paid for.
 *
 * FAIL-OPEN, deliberately. If the unit catalogue cannot be loaded, or the
 * unit is not in it, `allowsFractions` returns `undefined` and the caller
 * validates nothing. This is UX guidance, not an authorisation boundary: a
 * read failure must never block an operator from posting a receipt, and the
 * database rejects nothing here either way (see "What is NOT enforced" in the
 * WS-D-13 report).
 */
import { useCallback, useEffect, useState } from 'react';

import * as ipc from '../../shared/ipc/gateway';

export interface UnitFractionRules {
  /** `undefined` when the unit is unknown — the caller then validates nothing. */
  allowsFractionsById: (unitId: number | null | undefined) => boolean | undefined;
  /** Codes are matched case-insensitively, mirroring `units.normalized_code`. */
  allowsFractionsByCode: (unitCode: string | null | undefined) => boolean | undefined;
}

export function useUnitFractionRules(token: string): UnitFractionRules {
  const [byId, setById] = useState<Map<number, boolean>>(new Map());
  const [byCode, setByCode] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (!token) return;
    let active = true;
    void ipc.listUnitsV2(token)
      .then((units) => {
        if (!active) return;
        setById(new Map(units.map((u) => [u.id, u.allows_fractions])));
        setByCode(new Map(units.map((u) => [u.code.trim().toUpperCase(), u.allows_fractions])));
      })
      .catch(() => {
        // Fail open; see the header note.
      });
    return () => { active = false; };
  }, [token]);

  const allowsFractionsById = useCallback(
    (unitId: number | null | undefined) => (unitId == null ? undefined : byId.get(unitId)),
    [byId],
  );

  const allowsFractionsByCode = useCallback(
    (unitCode: string | null | undefined) =>
      (unitCode ? byCode.get(unitCode.trim().toUpperCase()) : undefined),
    [byCode],
  );

  return { allowsFractionsById, allowsFractionsByCode };
}
