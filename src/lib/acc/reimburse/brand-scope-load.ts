/**
 * The database half of AP-4's per-brand approver scope (Task 3 of the AP-4
 * ERP groups work). `./brand-scope.ts` is the pure rule — this module is the
 * pool-reaching half that feeds it real rows.
 *
 * Both reads go through `getAccPool()`, not `getProductionFormPool()`: AP-4's
 * accounting roster already follows the viewer's resolved Production/UAT
 * environment (`listReimburseApprovers`, `settings-service.ts`), and a
 * tester's scope check has to read the same copy of the roster their actions
 * will be checked against.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";
import { listBrandErpInterfaceMaps } from "@/lib/acc/brand-erp-interface-map-service";
import { normalizeScopeTargets } from "./brand-scope";

/**
 * The ticked interface-brand targets for the active `AccReimburseApprover`
 * row matching this actor.
 *
 * Matching is StaffId first, then the trimmed lower-cased Email — the exact
 * fallback `findActiveApprover` (`./approval-policy.ts`) uses for every other
 * AP-4 accounting action, so a scope check and an approval action agree on
 * which roster row is "this person". Only an active row is considered.
 *
 * **`null` means "no active roster row for this person at all" — not "not an
 * approver but present", and not the same thing as `[]`.** `[]` would mean an
 * active approver whose scope is empty, a state `setReimburseApproverBrands`
 * (`./settings-service.ts`) makes impossible by keeping `IsActive` in step
 * with the tick set — so if this ever answered `[]` for "no such row", a
 * caller would be unable to tell that apart from a real, if pointless,
 * approver. Task 5's guard is the caller that branches on this distinction.
 */
export async function loadApproverScopeByStaffId(
  staffId: number | null,
  email: string | null,
): Promise<string[] | null> {
  const pool = await getAccPool();

  let approverId: number | null = null;

  if (staffId != null) {
    const byStaff = await pool
      .request()
      .input("staff", sql.Int, staffId)
      .query(
        `SELECT TOP 1 Id FROM [dbo].[AccReimburseApprover]
         WHERE IsActive = 1 AND StaffId = @staff`,
      );
    approverId = (byStaff.recordset[0]?.Id as number | undefined) ?? null;
  }

  if (approverId == null) {
    const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!trimmedEmail) return null;
    const byEmail = await pool
      .request()
      .input("email", sql.NVarChar, trimmedEmail)
      .query(
        // ORDER BY, not an arbitrary TOP 1: `findActiveApprover` resolves a
        // shared email deterministically, by taking the first row of
        // `listReimburseApprovers()`'s `ORDER BY DisplayName, StaffId`. Two
        // active rows sharing an address is a contemplated case
        // (`approval-policy.test.ts` pins it), so the two must agree about
        // WHICH of them the actor is — otherwise a person's scope and their
        // approver identity could come from different rows.
        `SELECT TOP 1 Id FROM [dbo].[AccReimburseApprover]
         WHERE IsActive = 1 AND LOWER(LTRIM(RTRIM(Email))) = @email
         ORDER BY DisplayName, StaffId`,
      );
    approverId = (byEmail.recordset[0]?.Id as number | undefined) ?? null;
  }

  if (approverId == null) return null;

  const brands = await pool
    .request()
    .input("approver", sql.Int, approverId)
    .query(
      `SELECT InterfaceBrandCode FROM [dbo].[AccReimburseApproverBrand]
       WHERE ApproverId = @approver
       ORDER BY InterfaceBrandCode`,
    );
  // Normalised on the way OUT, not left to each caller. The column has no CHECK
  // (migration 144, mirroring 038), so a hand-inserted `'rocks'` or `'  KSI '`
  // is representable — and while `canActOnTarget` re-normalises at comparison
  // time, a caller who reasonably writes `scope.length > 0` instead of
  // `isApproverScope(scope)` would read such a row as a real scope. That is the
  // exact mistake Task 2's review caught once already; one call here removes the
  // footgun rather than relying on every future caller to avoid it.
  return normalizeScopeTargets(
    (brands.recordset as { InterfaceBrandCode: string }[]).map((row) => row.InterfaceBrandCode),
  );
}

/**
 * Claim brand → interface target, AP-4's own view of `AccBrandErpInterface`:
 * the shared `FormCode IS NULL` default, overridden per brand where an
 * `AP-4`-scoped row exists.
 *
 * Routed through `listBrandErpInterfaceMaps(AP4_FORM_CODE)` — which itself
 * applies `perFormPredicate` / `pickAllForForm` from `@/lib/acc/per-form-config`
 * — rather than a hand-written predicate here. A copy that loses the
 * `IS NULL` arm silently reads another form's mapping, and this table decides
 * where a claim's journal posts and, via `resolveClaimTarget` below, who may
 * approve it.
 */
export async function loadClaimBrandTargets(): Promise<Map<string, string>> {
  const rows = await listBrandErpInterfaceMaps(AP4_FORM_CODE);
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.brandCode.trim().toUpperCase(), row.interfaceBrandCode.trim().toUpperCase());
  }
  return map;
}

/**
 * The interface target `brandCode` resolves to under AP-4's mapping, or
 * `null` when the brand is blank or has no mapping at all — the fail-safe
 * direction `canActOnTarget` also takes for an unresolved target: invisible
 * to every scoped approver rather than visible to all of them.
 *
 * **This deliberately disagrees with `erp-interface-settings-service.ts`,
 * — specifically its OLD flat loader, `loadReimburseErpInterfaceSettings`,
 * which Task 7 deletes; the grouped `loadReimburseErpGroups` that replaced it
 * drops such a brand into an `unassigned` bucket instead, which agrees with
 * this function. Once the flat loader is gone this paragraph describes history
 * rather than a live divergence, and the reasoning below is still why this
 * function must keep answering `null`.
 *
 * The flat loader answers the same question as `interfaceBrandCode ?? code` — the brand
 * mapped to ITSELF.** Both are right for their own purpose and the divergence
 * is the point: that one is building a settings screen, where showing an
 * unmapped brand under a group named after itself is merely unhelpful; this
 * one decides who may approve a payment, where "unknown" must never widen to
 * "anyone". Do not make them agree by giving this one the fallback.
 *
 * What the disagreement costs, so it is read rather than discovered: a claim
 * filed under a brand with no mapping — `ROCKS`, which migration 092 really
 * does seed for AP-4 — is actionable by **nobody but an admin**, while the
 * Interface ERP tab shows that brand grouped as though configured. Deleting a
 * mapping does the same thing silently. Task 5 says so on screen rather than
 * rendering an unexplained empty queue.
 *
 * **Batch callers want `loadClaimBrandTargets` instead.** This issues a query
 * per call, so using it per queue row is an N+1 on an authorization path.
 */
export async function resolveClaimTarget(brandCode: string | null): Promise<string | null> {
  if (!brandCode) return null;
  const targets = await loadClaimBrandTargets();
  return targets.get(brandCode.trim().toUpperCase()) ?? null;
}
