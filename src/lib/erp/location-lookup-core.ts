/**
 * Branch → { Business Unit, blocked } for one brand, folded out of the synced
 * Locations and the BRANCH dimension values.
 *
 * Pure on purpose: the database read lives in `location-lookup.ts`, so the tests
 * import this file and not the connection pool (`src/env.ts` validates the whole
 * environment the moment it loads).
 */

export interface LocationRow {
  branchCode: string | null;
  buCode: string | null;
  /** The BRANCH dimension value is blocked in BC. Joined at read time, not stored. */
  isBranchBlocked: boolean;
}

export interface BranchLookupEntry {
  /**
   * Null when the Location carries no BU. The caller then sends no `buCode`
   * key at all, and that absence is what makes codeunit 50263 apply its own
   * fallback — a blank string would be sent as an answer.
   */
  buCode: string | null;
  /**
   * BC refuses a journal line whose dimension value is blocked, one line at a
   * time, with a reason nothing on this side stores. Knowing before the send is
   * the point.
   */
  isBlocked: boolean;
}

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * First row wins for a repeated branch. PCMY has two Locations on branch MW001
 * (`INTRANSIT` and `MW001` itself), so this is not hypothetical — both are COCO
 * today, and first-wins keeps the answer the same on every sync rather than
 * following whatever order the rows arrive in.
 */
export function buildBranchLookup(rows: readonly LocationRow[]): Map<string, BranchLookupEntry> {
  const map = new Map<string, BranchLookupEntry>();
  for (const r of rows) {
    // Both sides are upper-cased: the branch reaches this map from an expense
    // line and the BU from BC, neither guarantees case, and a miss would not
    // fail loudly — it would quietly return the COCO default, which is the exact
    // bug this lookup exists to fix.
    const branch = clean(r.branchCode)?.toUpperCase();
    if (!branch) continue;
    if (map.has(branch)) continue;
    map.set(branch, { buCode: clean(r.buCode), isBlocked: r.isBranchBlocked });
  }
  return map;
}
