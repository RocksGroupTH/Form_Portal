/**
 * Claim brands, grouped by the Business Central company their journals post
 * into — and what a value shared across such a group resolves to.
 *
 * AP-1 and AP-4's Interface ERP tabs are shaped this way already; AP-2 and
 * AP-3's are being brought to it (`docs/superpowers/specs/2026-09-14-ap2-ap3-erp-interface-groups-design.md`).
 * AP-1's own `brand-erp-interface-groups.ts` does the same job but is typed to
 * that screen's row shape, and its file has an uncommitted stash against it, so
 * this is the form-agnostic half rather than a widening of that one.
 *
 * **A group is a presentation. Nothing is stored against a target.** Every row
 * these screens write stays keyed on the claim brand, and a "group value" is
 * written to each member — see the spec, or the two reasons in one line:
 * `resolveJournalBatchName` reads a target-keyed row FIRST and would beat every
 * per-brand row, and AP-3's payload reads its config by claim brand and would
 * never see a target-keyed one.
 *
 * Pure and import-free, so both are unit-tested without a database.
 */

/** The least a row needs to be grouped: which claim brand it is. */
export interface ClaimBrandLike {
  brandCode: string;
}

export interface TargetGroup<T extends ClaimBrandLike> {
  /** The BC company, upper-cased. */
  target: string;
  members: T[];
}

export interface Grouped<T extends ClaimBrandLike> {
  groups: TargetGroup<T>[];
  /** Claim brands mapped to no target at all — actionable by nobody until mapped. */
  unassigned: T[];
}

/**
 * Group claim brands by their interface target.
 *
 * `order` is the order groups come out in — the four companies as the brand
 * picker lists them. A target outside it still gets a group, after those, rather
 * than being dropped: a mapping to a company nobody expected is exactly the
 * thing somebody needs to see.
 */
export function groupByTarget<T extends ClaimBrandLike>(
  rows: readonly T[],
  targetByClaim: Readonly<Record<string, string>>,
  order: readonly string[] = [],
): Grouped<T> {
  const unassigned: T[] = [];
  const byTarget = new Map<string, T[]>();

  for (const row of rows) {
    const target = (targetByClaim[row.brandCode] ?? "").trim().toUpperCase();
    if (!target) {
      unassigned.push(row);
      continue;
    }
    const list = byTarget.get(target) ?? [];
    list.push(row);
    byTarget.set(target, list);
  }

  const rank = (code: string) => {
    const i = order.indexOf(code);
    return i === -1 ? order.length : i;
  };
  const groups = Array.from(byTarget.entries())
    .map(([target, members]) => ({ target, members }))
    .sort((a, b) => rank(a.target) - rank(b.target) || a.target.localeCompare(b.target));

  return { groups, unassigned };
}

/** Every target in `order`, including the ones no claim brand maps to yet. */
export function groupByTargetIncludingEmpty<T extends ClaimBrandLike>(
  rows: readonly T[],
  targetByClaim: Readonly<Record<string, string>>,
  order: readonly string[],
): Grouped<T> {
  const { groups, unassigned } = groupByTarget(rows, targetByClaim, order);
  const seen = new Map(groups.map((g) => [g.target, g]));
  const all = order.map((target) => seen.get(target) ?? { target, members: [] as T[] });
  // Targets outside `order` keep their place after it, rather than vanishing.
  for (const g of groups) if (!order.includes(g.target)) all.push(g);
  return { groups: all, unassigned };
}

export type GroupValue =
  /** Every member says the same thing — including "all blank", where `value` is "". */
  | { kind: "agreed"; value: string }
  /**
   * One value among members that have one, and others have none. Saving writes
   * it to them — which is the point of the screen, not a side effect to hide.
   */
  | { kind: "fill"; value: string; blankMembers: string[] }
  /**
   * Two or more members carry DIFFERENT non-blank values. Never resolved here:
   * a pick would overwrite one real decision with another, on configuration
   * that decides where money posts.
   */
  | { kind: "conflict"; values: { brandCode: string; value: string }[] };

/**
 * What one field shared across a group currently is.
 *
 * Measured case this exists for (2026-09-14): PCTH and ROCKS are one group and
 * their VAT-input accounts differ — PCTH has none. That is PCTH never having
 * been filled in rather than a difference somebody chose, and AP-3's payload
 * throws for a PCTH clearing carrying VAT, so the screen offering to fill it is
 * a repair. Two members with two real values is a different thing and is
 * refused.
 */
export function groupValue(
  members: readonly { brandCode: string; value: string | null | undefined }[],
): GroupValue {
  const set: { brandCode: string; value: string }[] = [];
  const blank: string[] = [];
  for (const m of members) {
    const v = (m.value ?? "").trim();
    if (v === "") blank.push(m.brandCode);
    else set.push({ brandCode: m.brandCode, value: v });
  }

  if (set.length === 0) return { kind: "agreed", value: "" };

  const distinct = Array.from(new Set(set.map((s) => s.value)));
  if (distinct.length > 1) return { kind: "conflict", values: set };

  return blank.length === 0
    ? { kind: "agreed", value: distinct[0] }
    : { kind: "fill", value: distinct[0], blankMembers: blank };
}
