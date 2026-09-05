/**
 * WS-D-9B — row-click precedence.
 *
 * A catalog row opens the detail panel when clicked, which makes the editing
 * the Owner could not find impossible to miss. But two things inside a row own
 * their click and must win: the expand chevron, and an inline-editable cell.
 *
 * Clicking a price or minimum-stock cell must edit THAT cell. If the row
 * handler ran as well, the panel would slide over the input the user just
 * opened, and the edit they came to make would be one they could no longer
 * see. Marking those subtrees `data-row-click="ignore"` keeps the precedence
 * declarative and in one place rather than spread across stopPropagation calls
 * that are easy to forget on the next control someone adds.
 */
export function isRowClickIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[data-row-click="ignore"]') !== null;
}
