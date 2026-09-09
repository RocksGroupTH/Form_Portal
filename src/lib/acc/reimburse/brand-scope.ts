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
 * The four-code allow-list below is inlined rather than imported from
 * erp-interface-brands.ts, to keep this module free of imports — see
 * brand-scope.test.ts, which imports ERP_INTERFACE_BRANDS itself and asserts
 * the two lists cannot drift apart.
 */

/**
 * Mirrors ERP_INTERFACE_BRANDS' codes (src/lib/acc/erp-interface-brands.ts).
 * Kept as a local, import-free literal on purpose — see the module docblock
 * and the drift guard in brand-scope.test.ts.
 */
export const SCOPE_BRAND_CODES: readonly string[] = ["PCTH", "KSI", "PCMY", "UNO"];

/**
 * Is this a real, recognised target code? The one place the four-code
 * vocabulary is applied, so `isApproverScope` and `canActOnTarget` agree with
 * `normalizeScopeTargets` about what counts rather than each deciding for
 * itself.
 *
 * `AccReimburseApproverBrand.InterfaceBrandCode` deliberately has no CHECK
 * constraint (migration 144, mirroring 038), so a blank or foreign value is
 * representable in the table. This function is what makes such a row inert
 * instead of a grant.
 */
function isKnownTarget(value: unknown): boolean {
  return (
    typeof value === "string" && SCOPE_BRAND_CODES.indexOf(value.trim().toUpperCase()) !== -1
  );
}

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
  return targets.some(isKnownTarget);
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
  return targets.some((t) => isKnownTarget(t) && String(t).trim().toUpperCase() === normalized);
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
 * narrowed to the known interface brand codes. Anything that is not a
 * non-empty string, or is a string but not one of the four codes, is dropped
 * rather than kept: an unrecognised value must never become a grant.
 */
export function normalizeScopeTargets(raw: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isKnownTarget(item)) continue;
    const code = (item as string).trim().toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}
