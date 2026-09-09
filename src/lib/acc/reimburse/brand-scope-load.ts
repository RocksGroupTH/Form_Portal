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
        `SELECT TOP 1 Id FROM [dbo].[AccReimburseApprover]
         WHERE IsActive = 1 AND LOWER(LTRIM(RTRIM(Email))) = @email`,
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
  return (brands.recordset as { InterfaceBrandCode: string }[]).map((row) =>
    String(row.InterfaceBrandCode ?? "").trim(),
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
 */
export async function resolveClaimTarget(brandCode: string | null): Promise<string | null> {
  if (!brandCode) return null;
  const targets = await loadClaimBrandTargets();
  return targets.get(brandCode.trim().toUpperCase()) ?? null;
}
