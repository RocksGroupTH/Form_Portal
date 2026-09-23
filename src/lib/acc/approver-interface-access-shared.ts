/**
 * What an approver may act on, expressed over interface brand codes.
 *
 * **Pure and import-free since 2026-09-23**, and that is a property worth
 * naming: this module answers authorization questions — `canActOnInterfaceTarget`,
 * `canActOnClaimBrand`, `canRetargetClaimBrand` — on paths that move money, and
 * it is unit-tested with no database precisely because it reaches nothing.
 *
 * It used to import `ERP_INTERFACE_BRANDS` for one function,
 * `allInterfaceBrandCodes()`. That constant became a database read
 * (`listErpInterfaceBrands`), and importing the async version would have made
 * this module async and un-pure for the sake of a default. The codes are passed
 * in instead — every caller already has them, from `listErpInterfaceBrands()`
 * server-side or `useErpInterfaceBrands()` in the browser.
 */

export interface ApproverInterfaceAccess {
  /** true = no rows in AccApproverInterfaceBrand (or IT Admin) */
  allAccess: boolean;
  /** Uppercase interface brand codes the user may see (PCTH, KSI, …) */
  allowedCodes: string[];
}

/**
 * The codes this access resolves to.
 *
 * `allAccess` means every interface brand, so the caller's list IS the answer —
 * which is why it has to be supplied rather than looked up here. An empty
 * `allCodes` under `allAccess` therefore answers empty, and that is correct
 * rather than a fail-open: it means the caller does not yet know what the
 * brands are, and a list filtered to nothing shows nothing. **It is never used
 * to decide whether somebody MAY act** — `canActOnInterfaceTarget` below is,
 * and it short-circuits on `allAccess` without consulting any list at all.
 */
export function filterInterfaceBrandCodes(
  access: ApproverInterfaceAccess,
  allCodes: readonly string[],
): string[] {
  if (access.allAccess) return Array.from(allCodes);
  return access.allowedCodes;
}

export function filterRowsForInterfaceAccess<T extends { brandCode: string | null }>(
  rows: T[],
  interfaceByClaim: Record<string, string>,
  access: ApproverInterfaceAccess,
): T[] {
  if (access.allAccess) return rows;
  if (access.allowedCodes.length === 0) return [];
  const allowed = new Set(access.allowedCodes);
  return rows.filter((row) => {
    const claim = (row.brandCode ?? "").trim().toUpperCase();
    if (!claim) return false;
    const target = interfaceByClaim[claim]?.trim().toUpperCase();
    return target ? allowed.has(target) : false;
  });
}

export function buildInterfaceByClaimRecord(
  maps: { brandCode: string; interfaceBrandCode: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of maps) {
    out[m.brandCode.trim().toUpperCase()] = m.interfaceBrandCode.trim().toUpperCase();
  }
  return out;
}

/**
 * May this approver act on documents bound for `interfaceTarget`?
 *
 * The list endpoint scoped its rows with `filterRowsForInterfaceAccess`, which
 * is a *display* filter — a KSI-only approver simply saw no PCTH rows. Every
 * direct-by-id path skipped it entirely and checked only `canAccessAccountArea`:
 * the prep detail, the report export (including its `ids=` form, which takes an
 * explicit list and so bypasses row filtering by construction), the ACCOUNT
 * approve and reject, and the ERP send itself. A list filter is not an
 * authorization control; anyone who knew a number was out of scope of nothing.
 *
 * `allowedCodes` empty with `allAccess` false means "no interface brands at
 * all", which is what a non-approver resolves to — refused rather than waved
 * through.
 */
export function canActOnInterfaceTarget(
  access: ApproverInterfaceAccess,
  interfaceTarget: string | null | undefined,
): boolean {
  if (access.allAccess) return true;
  const target = (interfaceTarget ?? "").trim().toUpperCase();
  if (!target) return false;
  return access.allowedCodes.some((c) => c.trim().toUpperCase() === target);
}

/**
 * The same question for a document identified by its own claim brand, which is
 * what `AccRequest.BrandCode` holds — the interface target is derived from it
 * through the claim → interface map.
 */
export function canActOnClaimBrand(
  access: ApproverInterfaceAccess,
  interfaceByClaim: Record<string, string>,
  claimBrandCode: string | null | undefined,
): boolean {
  if (access.allAccess) return true;
  const claim = (claimBrandCode ?? "").trim().toUpperCase();
  if (!claim) return false;
  return canActOnInterfaceTarget(access, interfaceByClaim[claim]);
}

/**
 * May this approver repoint a claim brand at a different set of books?
 *
 * `AccApproverInterfaceBrand` scopes the same roster row everywhere else — the
 * ERP send, the prep detail, the ACCOUNT approve/reject, the report export all
 * ask `canActOnInterfaceTarget`. `settings/erp-config` was the one place the
 * same person was unscoped: it validated only that the claim brand is enabled
 * in AP-1, so a KSI-scoped approver holding the `erpInterface` grant could
 * point PCTH's claims at any company they liked. Deciding *where* a claim's
 * journals post is a stronger power than approving one of them.
 *
 * Both ends are checked, because either one moves money:
 *
 * - **the target it has now** — repointing PCTH's claims is taking documents
 *   out of books that are not yours, even if the new target is;
 * - **the target it is being given** — sending someone else's claims into your
 *   own company is the same act from the other side.
 *
 * An unmapped claim brand has no current target and nothing to protect, so a
 * scoped approver may give it one of their own. `nextTarget` is null for the
 * clear (DELETE), which asks only the first question.
 */
export function canRetargetClaimBrand(
  access: ApproverInterfaceAccess,
  currentTarget: string | null | undefined,
  nextTarget: string | null | undefined,
): boolean {
  if (access.allAccess) return true;
  const current = (currentTarget ?? "").trim();
  if (current && !canActOnInterfaceTarget(access, current)) return false;
  const next = (nextTarget ?? "").trim();
  if (next && !canActOnInterfaceTarget(access, next)) return false;
  return true;
}

/** What a scoped-out actor is told. Deliberately does not name the target. */
export const INTERFACE_SCOPE_ERROR =
  "ไม่มีสิทธิ์ในกลุ่ม Interface ของเอกสารนี้";

/** The same refusal for a configuration change rather than a document. */
export const INTERFACE_TARGET_SCOPE_ERROR =
  "ไม่มีสิทธิ์ในกลุ่ม Interface ของแบรนด์นี้";
