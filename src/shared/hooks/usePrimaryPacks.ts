import { useContext, useEffect, useMemo, useState } from 'react';
import { SessionContext } from '../session/SessionContext';
import { getPrimaryPacks } from '../ipc/gateway';
import type { PrimaryPack } from '../ipc/dto';

const BATCH_SIZE = 500;

// Module-level cache for the app session.
// Maps variantId -> PrimaryPack | null (null indicates variant has no primary pack)
const primaryPackCache = new Map<number, PrimaryPack | null>();
const cacheListeners = new Set<() => void>();

/**
 * Invalidates the primary pack cache (e.g. when packs are added, edited, or removed in PackManager).
 * Notifies all active usePrimaryPacks hooks to re-fetch on their next cycle.
 */
export function invalidatePrimaryPacks(): void {
  primaryPackCache.clear();
  cacheListeners.forEach((listener) => listener());
}

/**
 * Helper to split an array into chunks of at most `size`.
 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export interface UsePrimaryPacksResult {
  packs: Map<number, PrimaryPack>;
  loading: boolean;
}

/**
 * Hook to fetch and cache primary packs for a list of variant IDs.
 * - De-duplicates IDs
 * - Checks module-level cache
 * - Batches requests into chunks of at most 500
 * - Never throws on error (falls back to whatever packs are available)
 */
export function usePrimaryPacks(variantIds: number[]): UsePrimaryPacksResult {
  const session = useContext(SessionContext);
  const token = session?.user?.token ?? '';
  const [, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);

  // Subscribe to cache invalidations
  useEffect(() => {
    const handleInvalidation = () => setVersion((v) => v + 1);
    cacheListeners.add(handleInvalidation);
    return () => {
      cacheListeners.delete(handleInvalidation);
    };
  }, []);

  // Filter unique valid variant IDs
  const uniqueIds = useMemo(() => {
    return Array.from(
      new Set(
        variantIds.filter(
          (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0
        )
      )
    );
  }, [variantIds]);

  useEffect(() => {
    if (!token || uniqueIds.length === 0) {
      setLoading(false);
      return;
    }

    const missingIds = uniqueIds.filter((id) => !primaryPackCache.has(id));
    if (missingIds.length === 0) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const batches = chunkArray(missingIds, BATCH_SIZE);

    Promise.all(
      batches.map(async (batch) => {
        try {
          const results = await getPrimaryPacks(token, batch);
          if (!isMounted) return;

          const returnedMap = new Map<number, PrimaryPack>();
          for (const pack of results) {
            returnedMap.set(pack.variant_id, pack);
            primaryPackCache.set(pack.variant_id, pack);
          }

          // Mark any ID in this batch not returned by backend as null (no primary pack)
          for (const id of batch) {
            if (!returnedMap.has(id)) {
              primaryPackCache.set(id, null);
            }
          }
        } catch {
          // Spec: on error, never throw (the screen falls back to plain quantities)
        }
      })
    ).finally(() => {
      if (isMounted) {
        setLoading(false);
        setVersion((v) => v + 1);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [token, uniqueIds]);

  const packs = useMemo(() => {
    const map = new Map<number, PrimaryPack>();
    for (const id of uniqueIds) {
      const pack = primaryPackCache.get(id);
      if (pack) {
        map.set(id, pack);
      }
    }
    return map;
  }, [uniqueIds, loading]);

  return { packs, loading };
}
