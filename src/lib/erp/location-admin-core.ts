/**
 * Pure summaries for the Location / BU settings tab. Split from the database
 * read for the usual reason: the tests import this and not the connection pool.
 */

export interface BuSpreadEntry {
  /** Null is the "no BU on the Location" group, kept apart from every real code. */
  buCode: string | null;
  count: number;
}

/**
 * How many Locations sit on each Business Unit, commonest first.
 *
 * This is the one line that tells an accountant whether a sync brought back what
 * they expected — `COCO 130 · DODO-M 36 · …` against an estate they know. Ties
 * break by code so the same data always renders the same way, and the no-BU
 * group sorts last however large it grows: those are the Locations whose lines
 * fall back to the codeunit's COCO, which is worth seeing on its own rather than
 * silently added to the real COCO count.
 */
export function summarizeBuSpread(rows: readonly { buCode: string | null }[]): BuSpreadEntry[] {
  const counts = new Map<string | null, number>();
  for (const r of rows) {
    const key = r.buCode?.trim() ? r.buCode.trim() : null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: BuSpreadEntry[] = [];
  counts.forEach((count, buCode) => out.push({ buCode, count }));
  return out
    .sort((a, b) => {
      if (a.buCode === null) return 1;
      if (b.buCode === null) return -1;
      if (a.count !== b.count) return b.count - a.count;
      return a.buCode.localeCompare(b.buCode);
    });
}
