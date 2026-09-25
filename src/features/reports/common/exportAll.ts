// WS-I-1 §5.8 — fetches every page of a paginated report before printing,
// saving as PDF, or exporting to CSV (PART 15 note 8: exports must never be
// limited to the visible page).

const PAGE_SIZE = 500;

export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ total_count: number; rows: T[] }>,
  cap = 20_000,
): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const page = await fetchPage(offset, PAGE_SIZE);
    total = page.total_count;
    rows.push(...page.rows);
    offset += page.rows.length;
    if (page.rows.length === 0) break;
    if (offset >= total) break;
    if (rows.length >= cap) break;
  }
  return { rows: rows.slice(0, cap), capped: total > cap };
}
