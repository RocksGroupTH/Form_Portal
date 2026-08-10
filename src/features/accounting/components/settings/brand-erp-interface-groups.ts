import type {
  AccBrandErpConfigRow,
  AccBrandJournalBatchRow,
  AccErpTargetBrandOption,
} from "@/features/accounting/types";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";

export interface TargetErpGroup {
  targetBrandCode: string;
  targetBrandName: string;
  targetBrandLogo: string;
  claimRows: AccBrandErpConfigRow[];
}

export interface JournalTargetRef {
  batchName: string;
  id?: number;
}

export function buildTargetErpGroups(
  brands: AccBrandErpConfigRow[],
  targetByClaim: Record<string, string>,
  targetBrands: AccErpTargetBrandOption[],
): { groups: TargetErpGroup[]; unassigned: AccBrandErpConfigRow[] } {
  const unassigned: AccBrandErpConfigRow[] = [];
  const byTarget = new Map<string, AccBrandErpConfigRow[]>();

  for (const row of brands) {
    const target = (targetByClaim[row.brandCode] ?? row.interfaceBrandCode ?? "").trim().toUpperCase();
    if (!target) {
      unassigned.push(row);
      continue;
    }
    const list = byTarget.get(target) ?? [];
    list.push(row);
    byTarget.set(target, list);
  }

  const groups: TargetErpGroup[] = Array.from(byTarget.entries()).map(([targetBrandCode, claimRows]) => {
    const t = targetBrands.find((x) => x.brandCode.toUpperCase() === targetBrandCode);
    return {
      targetBrandCode,
      targetBrandName: t?.brandName ?? targetBrandCode,
      targetBrandLogo: `/brandlogo/${targetBrandCode.toLowerCase()}-200.png`,
      claimRows,
    };
  });

  const order = ERP_INTERFACE_BRANDS.map((b) => b.id);
  groups.sort((a, b) => {
    const ai = order.indexOf(a.targetBrandCode);
    const bi = order.indexOf(b.targetBrandCode);
    if (ai === -1 && bi === -1) return a.targetBrandCode.localeCompare(b.targetBrandCode);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return { groups, unassigned };
}

/** All ERP interface targets (PCTH, KSI, PCMY, UNO) — empty groups included. */
export function buildAllTargetErpGroups(
  brands: AccBrandErpConfigRow[],
  targetByClaim: Record<string, string>,
  targetBrands: AccErpTargetBrandOption[],
): { groups: TargetErpGroup[]; unassigned: AccBrandErpConfigRow[] } {
  const { groups, unassigned } = buildTargetErpGroups(brands, targetByClaim, targetBrands);
  const byCode = new Map(groups.map((g) => [g.targetBrandCode.toUpperCase(), g]));

  const allGroups: TargetErpGroup[] = ERP_INTERFACE_BRANDS.map((iface) => {
    const code = iface.id.toUpperCase();
    const existing = byCode.get(code);
    if (existing) return existing;
    const t = targetBrands.find((x) => x.brandCode.toUpperCase() === code);
    return {
      targetBrandCode: code,
      targetBrandName: t?.brandName ?? iface.name,
      targetBrandLogo: `/brandlogo/${code.toLowerCase()}-200.png`,
      claimRows: [],
    };
  });

  return { groups: allGroups, unassigned };
}

export function groupMemberCodes(
  targetBrandCode: string,
  brands: AccBrandErpConfigRow[],
  targetByClaim: Record<string, string>,
): string[] {
  const key = targetBrandCode.toUpperCase();
  return brands
    .filter((b) => (targetByClaim[b.brandCode]?.trim().toUpperCase() ?? "") === key)
    .map((b) => b.brandCode);
}

/** Claim brands not assigned to any interface target. */
export function unassignedClaimBrands(
  brands: AccBrandErpConfigRow[],
  targetByClaim: Record<string, string>,
): AccBrandErpConfigRow[] {
  return brands.filter((b) => !(targetByClaim[b.brandCode]?.trim()));
}

/** Journal batch stored under target brand; fallback legacy per-claim rows. */
export function resolveJournalForTarget(
  targetBrandCode: string,
  legacyClaimCodes: string[],
  journalBatchMap: Record<string, AccBrandJournalBatchRow>,
): JournalTargetRef {
  const targetKey = targetBrandCode.toUpperCase();
  const primary = journalBatchMap[targetKey];
  if (primary?.batchName?.trim()) {
    return { batchName: primary.batchName.trim(), id: primary.id };
  }
  for (const claim of legacyClaimCodes) {
    const row = journalBatchMap[claim.toUpperCase()];
    if (row?.batchName?.trim()) {
      return { batchName: row.batchName.trim(), id: row.id };
    }
  }
  return { batchName: "" };
}

export function claimCodesForGroup(group: TargetErpGroup): string[] {
  return group.claimRows.map((r) => r.brandCode);
}
