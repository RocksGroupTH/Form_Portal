/**
 * Pure read-side shaping for Locations — no IO, so the tests can import it.
 * `location-lookup.ts` wraps this with the database read.
 */

export interface LocationBuRow {
  branchCode: string | null;
  buCode: string | null;
}

/**
 * Branch code → the BU its Location is bound to, keyed upper-case.
 *
 * Both sides of the eventual lookup are untrusted for case: the branch comes off
 * an expense line, the BU out of BC. A case mismatch would not fail loudly — it
 * would quietly fall through to the codeunit's `COCO` default, which is the very
 * thing this map exists to stop.
 *
 * A row missing either half is left out rather than mapped to "". Absence is
 * meaningful downstream: the payload sends no `buCode` key at all, which is what
 * makes the codeunit apply its own fallback. A blank value would instead be sent
 * as an answer.
 *
 * Two Locations should never claim the same branch. If BC ever returns that, the
 * first wins — arbitrary, but deterministic, which beats resolving by row order
 * differently on each sync.
 */
export function buildBranchBuMap(rows: readonly LocationBuRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    const branch = r.branchCode?.trim().toUpperCase();
    const bu = r.buCode?.trim();
    if (!branch || !bu) continue;
    if (map.has(branch)) continue;
    map.set(branch, bu);
  }
  return map;
}
