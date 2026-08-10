import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import type { ApproverInterfaceAccess } from "@/lib/acc/approver-interface-access-shared";
import { filterInterfaceBrandCodes } from "@/lib/acc/approver-interface-access-shared";

export const ERP_INTERFACE_UNASSIGNED = "__UNASSIGNED__";

export function resolveClaimInterfaceTarget(
  claimBrandCode: string | null | undefined,
  interfaceByClaim: Record<string, string>,
): string {
  const claim = (claimBrandCode ?? "").trim().toUpperCase();
  if (!claim) return ERP_INTERFACE_UNASSIGNED;
  return interfaceByClaim[claim]?.trim().toUpperCase() || ERP_INTERFACE_UNASSIGNED;
}

export function isValidInterfaceTargetCode(code: string): boolean {
  const upper = code.trim().toUpperCase();
  if (upper === ERP_INTERFACE_UNASSIGNED) return true;
  return ERP_INTERFACE_BRANDS.some((b) => b.id === upper);
}

export function parseInterfaceTargetCode(raw: string | null | undefined): string {
  const fallback = ERP_INTERFACE_BRANDS[0]?.id ?? "PCTH";
  if (!raw) return fallback;
  const upper = raw.trim().toUpperCase();
  return isValidInterfaceTargetCode(upper) ? upper : fallback;
}

export function parseInterfaceTargetForAccess(
  raw: string | null | undefined,
  access: ApproverInterfaceAccess,
): string {
  const allowed = filterInterfaceBrandCodes(access);
  if (allowed.length === 0) return ERP_INTERFACE_BRANDS[0]?.id ?? "PCTH";

  const upper = raw?.trim().toUpperCase();
  if (upper === ERP_INTERFACE_UNASSIGNED && access.allAccess) return upper;
  if (upper && allowed.includes(upper)) return upper;
  return allowed[0];
}

export function pickDefaultInterfaceTargetForAccess(
  counts: Record<string, number>,
  access: ApproverInterfaceAccess,
): string {
  const allowed = filterInterfaceBrandCodes(access);
  for (const code of allowed) {
    if ((counts[code] ?? 0) > 0) return code;
  }
  if (access.allAccess && (counts[ERP_INTERFACE_UNASSIGNED] ?? 0) > 0) {
    return ERP_INTERFACE_UNASSIGNED;
  }
  return allowed[0] ?? ERP_INTERFACE_BRANDS[0]?.id ?? "PCTH";
}

export function filterRowsByInterfaceTarget<T extends { brandCode: string | null }>(
  rows: T[],
  interfaceByClaim: Record<string, string>,
  targetCode: string,
): T[] {
  const target = targetCode.trim().toUpperCase();
  return rows.filter(
    (row) => resolveClaimInterfaceTarget(row.brandCode, interfaceByClaim) === target,
  );
}

export function countRowsByInterfaceTarget<T extends { brandCode: string | null }>(
  rows: T[],
  interfaceByClaim: Record<string, string>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const iface of ERP_INTERFACE_BRANDS) {
    counts[iface.id] = 0;
  }
  counts[ERP_INTERFACE_UNASSIGNED] = 0;

  for (const row of rows) {
    const target = resolveClaimInterfaceTarget(row.brandCode, interfaceByClaim);
    counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}

export function pickDefaultInterfaceTarget(counts: Record<string, number>): string {
  for (const iface of ERP_INTERFACE_BRANDS) {
    if ((counts[iface.id] ?? 0) > 0) return iface.id;
  }
  if ((counts[ERP_INTERFACE_UNASSIGNED] ?? 0) > 0) return ERP_INTERFACE_UNASSIGNED;
  return ERP_INTERFACE_BRANDS[0]?.id ?? "PCTH";
}
