/**
 * The order AP-4 shows its brands in — on the settings grid, in what that grid
 * saves, and in the form's own picker.
 *
 * **`AccFormBrand.SortOrder` records nobody's intent.** No screen in this app
 * lets an admin choose an order for a form's brands: the settings tab is a
 * column of checkboxes rendered in the company brand master's order, and
 * `setFormBrands` writes `SortOrder = <position in the array it is handed>`.
 * So the stored order is whatever order the boxes happened to be ticked in.
 * Measured 2026-09-10, AP-4 held `PCTH(0), ROCKS(1)` while the grid three
 * clicks away rendered Rocks Group first — two screens, one list, two answers,
 * and nothing on either saying which was authoritative.
 *
 * Both halves below therefore defer to the master, and they are not redundant:
 *
 * - `orderBrandsForDisplay` is what actually fixes the picker, and it fixes it
 *   for rows already stored. It is applied in AP-4's own route rather than in
 *   `getAllowedBrands`, which four other forms and several ERP services read.
 * - `orderBrandCodesForSave` stops the settings tab writing an order it does
 *   not display. It changes nothing a reader sees while the read defers to the
 *   master — it keeps the stored data honest, so `SortOrder` stops being a
 *   record of clicks, and so the next screen to read it is not misled.
 *
 * Pure and import-free, so both are unit-tested without a database.
 */

/** Where each code sits in the order a human is actually shown. */
function positionsOf(displayOrder: string[]): Map<string, number> {
  const position = new Map<string, number>();
  for (let i = 0; i < displayOrder.length; i++) {
    // First occurrence wins, so a code repeated in the master cannot drag a
    // brand to the back by appearing again later.
    if (!position.has(displayOrder[i])) position.set(displayOrder[i], i);
  }
  return position;
}

/**
 * Sort by position in `displayOrder`, keeping everything.
 *
 * A code the master does not carry has no position — an orphan granted before
 * the brand was retired, or a claim's own saved code. It sorts **last** rather
 * than being dropped, and that is load-bearing in both directions: on the save
 * side this array is the *complete* active set and `setFormBrands` deactivates
 * whatever is missing from it; on the read side a picker that drops the code a
 * request is already saved against re-points that request at another company.
 *
 * `arrival` breaks every tie, so the answer does not depend on `Array#sort`
 * being stable and an empty `displayOrder` is exactly a no-op.
 */
function orderByMaster<T>(items: T[], codeOf: (item: T) => string, displayOrder: string[]): T[] {
  const position = positionsOf(displayOrder);
  return items
    .map((item, arrival) => {
      const at = position.get(codeOf(item));
      return { item, arrival, at: at === undefined ? Number.MAX_SAFE_INTEGER : at };
    })
    .sort((a, b) => a.at - b.at || a.arrival - b.arrival)
    .map((x) => x.item);
}

/** The settings tab's POST body: the ticked codes, in the order that tab renders them. */
export function orderBrandCodesForSave(
  checked: Iterable<string>,
  displayOrder: string[],
): string[] {
  return orderByMaster(Array.from(checked), (code) => code, displayOrder);
}

/** The AP-4 form's brand picker: the allowed brands, in the master's order. */
export function orderBrandsForDisplay<T extends { brandCode: string }>(
  allowed: T[],
  displayOrder: string[],
): T[] {
  return orderByMaster(allowed, (brand) => brand.brandCode, displayOrder);
}
