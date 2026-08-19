import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";

export interface ApproverInterfaceAccess {
  /** true = no rows in AccApproverInterfaceBrand (or IT Admin) */
  allAccess: boolean;
  /** Uppercase interface brand codes the user may see (PCTH, KSI, …) */
  allowedCodes: string[];
}

export function allInterfaceBrandCodes(): string[] {
  return ERP_INTERFACE_BRANDS.map((b) => b.id);
}

export function filterInterfaceBrandCodes(
  access: ApproverInterfaceAccess,
): string[] {
  if (access.allAccess) return allInterfaceBrandCodes();
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

/** What a scoped-out actor is told. Deliberately does not name the target. */
export const INTERFACE_SCOPE_ERROR =
  "ไม่มีสิทธิ์ในกลุ่ม Interface ของเอกสารนี้";
