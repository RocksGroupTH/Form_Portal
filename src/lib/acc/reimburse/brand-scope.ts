/**
 * Per-brand scope for AP-4's accounting approvers (AccReimburseApproverBrand,
 * migration 144). Pure and import-free, deliberately: @/env validates the
 * whole environment at import, so anything reachable from a pool drags a live
 * database configuration into what should be a plain unit test.
 *
 * ONE deliberate difference from AP-1's AccApproverInterfaceBrand /
 * approver-interface-access-shared.ts, whose `ApproverInterfaceAccess.allAccess`
 * is true exactly when `allowedCodes` is empty — AP-1 reads zero rows as
 * "unrestricted", so clearing an approver's last tick there silently promotes
 * them to every brand, with the grid then showing all four ticked. AP-4 must
 * have no state where absence means "all": zero targets is not full access,
 * it is no access. The tick set IS the on/off switch — a scope with nothing in
 * it belongs to someone who is not an approver at all.
 *
 * Never add an "empty means unrestricted" branch to isApproverScope or
 * canActOnTarget. Doing so reproduces the exact AP-1 failure this table exists
 * to avoid, and it does so silently: the grid would still render as expected
 * (four unticked boxes) while every action quietly passed.
 *
 * ## SCOPE_BRAND_CODES is GONE (2026-09-23), and that fixed a real defect
 *
 * This module held `["PCTH", "KSI", "PCMY", "UNO"]` as an import-free mirror
 * of ERP_INTERFACE_BRANDS, with a test asserting the two could not drift. The
 * test was doing its job right up to the moment the other list stopped being a
 * literal — and a mirror of a database read cannot be a literal at all.
 *
 * Left alone it was the reported bug one level down: an admin ticks a newly
 * configured brand for an AP-4 approver, `normalizeScopeTargets` silently
 * drops it as unknown, and the tick vanishes on save with no message.
 *
 * So the known set is now **passed in** on the write path, which is the only
 * path that needs it, and this module stays import-free — the property its
 * docblock opens with, and the reason every AP-4 queue policy that calls
 * `canActOnTarget` is still synchronous and unit-testable with no database.
 */

/**
 * Does this set of targets make its owner an approver at all?
 *
 * Zero targets answers false, not true. There is no "empty means every
 * brand" branch here — see the module docblock for why that must never be
 * added.
 *
 * It counts RECOGNISED targets, not array entries. `[""]` and `["ROCKS"]`
 * both answer false, because `canActOnTarget` would refuse every real brand
 * for such an owner and the two must not disagree about whether that person
 * is an approver. This matters concretely: the settings service keeps
 * `AccReimburseApprover.IsActive` in step with this answer, so counting bare
 * entries would mark somebody active with a scope that grants nothing — the
 * table has no CHECK on the column, so a blank row is representable.
 */
export function isApproverScope(targets: readonly string[]): boolean {
  /* A non-blank STRING entry, rather than membership of an allow-list. The
     entries reaching here have already been narrowed to the live interface
     brands — `brand-scope-load.ts` normalises on the way out of the table and
     the settings service normalises on the way in — so re-testing membership
     here would be a second, now-unavoidably-stale copy of that check, and it
     would read a legitimately ticked new brand as "not an approver". Blank
     and non-string entries still answer false, which is the case this
     function exists for: the column has no CHECK, so a blank row is
     representable and must not count as a grant. */
  return targets.some((t) => typeof t === "string" && t.trim().length > 0);
}

/**
 * May the owner of `targets` act on a document bound for `target`?
 *
 * An empty `targets` refuses unconditionally — there is no all-access
 * shortcut to fall into. A `target` that does not resolve to anything (null,
 * blank — an unmapped claim brand) also refuses: the fail-safe direction is
 * that it is visible to nobody at all, until an admin maps the brand — not to
 * everybody — which mirrors AP-1's own `canActOnInterfaceTarget` on this one
 * point even though the two modules disagree about the empty-`targets` case.
 */
export function canActOnTarget(
  targets: readonly string[],
  target: string | null,
): boolean {
  const normalized = (target ?? "").trim().toUpperCase();
  if (!normalized) return false;
  // `t` is typed `string` but arrives from a NOT NULL column with no CHECK, and
  // from JSON on the settings POST. A null or a number slipping through must
  // refuse, not throw: an exception inside an approver loop fails the whole
  // request where a refusal fails one row, and a crash is a worse way to be
  // safe than a no.
  /* **No allow-list test here any more, and that is safe for a reason worth
     stating.** It used to require each stored entry to be one of four known
     codes, which was a second, weaker copy of a check the write path already
     makes — and once the real list became a database read, this copy could
     only ever be stale, refusing a legitimately ticked brand.

     What protects the CHECK-less column (migration 144) is equality, not
     membership: `target` is the claim's own interface target, resolved from
     `AccBrandErpInterface`, so a junk row can only grant something by exactly
     equalling a real target — at which point it is not junk. The `typeof`
     test stays, because a null or a number from that column must refuse rather
     than throw inside an approver loop. */
  return targets.some(
    (t) => typeof t === "string" && t.trim().toUpperCase() === normalized,
  );
}

/**
 * Filter `rows` down to the ones whose target (via `targetOf`) is in scope,
 * preserving order. A row whose target does not resolve is dropped, same as
 * `canActOnTarget`.
 */
export function filterToScope<T>(
  rows: readonly T[],
  targets: readonly string[],
  targetOf: (row: T) => string | null,
): T[] {
  return rows.filter((row) => canActOnTarget(targets, targetOf(row)));
}

/**
 * Normalize a raw list of scope targets — trimmed, upper-cased, deduped, and
 * narrowed to `known`, the interface brand codes as they are TODAY. Anything
 * that is not a non-empty string, or is a string `known` does not carry, is
 * dropped
 * rather than kept: an unrecognised value must never become a grant.
 */
export function normalizeScopeTargets(
  raw: readonly unknown[],
  known: readonly string[],
): string[] {
  const allowed = new Set(known.map((c) => c.trim().toUpperCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const code = item.trim().toUpperCase();
    if (!code || !allowed.has(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}
