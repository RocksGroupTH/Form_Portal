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
