import type { ApproverInterfaceAccess } from "@/lib/acc/approver-interface-access-shared";
import { filterInterfaceBrandCodes } from "@/lib/acc/approver-interface-access-shared";

/**
 * Which Interface ERP group a claim belongs to, and which tab to open on.
 *
 * ## Every function that needs the brand list now TAKES it
 *
 * This module imported `ERP_INTERFACE_BRANDS` until 2026-09-23, when that
 * constant became a database read (`listErpInterfaceBrands`, derived from
 * which brands have a complete BC profile). It could have imported the async
 * version and become async itself; it deliberately did not.
 *
 * **It is a pure module and staying pure is worth more than the convenience.**
 * Its callers are client components that already hold the list — they read it
 * from `useErpInterfaceBrands()` — so threading it through costs one argument
 * and keeps every function here unit-testable with no database, no `@/env` and
 * no mocking. An async pure module is neither.
 *
 * `codes` is the interface brand codes in the master's own order, which is what
 * decides tab order and which tab is picked by default.
 *
 * ## An EMPTY `codes` no longer falls back to "PCTH"
 *
 * Three functions here ended `?? "PCTH"`, which was safe while the list was a
 * literal that always held four. It is not safe now: `codes` is empty both
 * while the fetch is in flight and on a deployment where nobody has completed a
 * Config BC, and naming a brand in either case is a guess that renders a tab
 * for a group this app may not be able to post into at all. They answer
 * `ERP_INTERFACE_UNASSIGNED` instead — the one bucket that always exists, is
 * always a valid target code, and says honestly that nothing has been chosen.
 */

export const ERP_INTERFACE_UNASSIGNED = "__UNASSIGNED__";

export function resolveClaimInterfaceTarget(
  claimBrandCode: string | null | undefined,
  interfaceByClaim: Record<string, string>,
): string {
  const claim = (claimBrandCode ?? "").trim().toUpperCase();
  if (!claim) return ERP_INTERFACE_UNASSIGNED;
  return interfaceByClaim[claim]?.trim().toUpperCase() || ERP_INTERFACE_UNASSIGNED;
}

export function isValidInterfaceTargetCode(code: string, codes: readonly string[]): boolean {
  const upper = code.trim().toUpperCase();
  if (upper === ERP_INTERFACE_UNASSIGNED) return true;
  return codes.some((c) => c.trim().toUpperCase() === upper);
}

export function parseInterfaceTargetCode(
  raw: string | null | undefined,
  codes: readonly string[],
): string {
  const fallback = codes[0] ?? ERP_INTERFACE_UNASSIGNED;
  if (!raw) return fallback;
  const upper = raw.trim().toUpperCase();
  return isValidInterfaceTargetCode(upper, codes) ? upper : fallback;
}

export function parseInterfaceTargetForAccess(
  raw: string | null | undefined,
  access: ApproverInterfaceAccess,
  codes: readonly string[],
): string {
  const allowed = filterInterfaceBrandCodes(access, codes);
  if (allowed.length === 0) return codes[0] ?? ERP_INTERFACE_UNASSIGNED;

  const upper = raw?.trim().toUpperCase();
  if (upper === ERP_INTERFACE_UNASSIGNED && access.allAccess) return upper;
  if (upper && allowed.includes(upper)) return upper;
  return allowed[0];
}

export function pickDefaultInterfaceTargetForAccess(
  counts: Record<string, number>,
  access: ApproverInterfaceAccess,
  codes: readonly string[],
): string {
  const allowed = filterInterfaceBrandCodes(access, codes);
  for (const code of allowed) {
    if ((counts[code] ?? 0) > 0) return code;
  }
  if (access.allAccess && (counts[ERP_INTERFACE_UNASSIGNED] ?? 0) > 0) {
    return ERP_INTERFACE_UNASSIGNED;
  }
  return allowed[0] ?? codes[0] ?? ERP_INTERFACE_UNASSIGNED;
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
  codes: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  // Seeded at zero so a group with no rows still renders its tab with a 0
  // rather than disappearing. A code the caller has not yet loaded simply has
  // no tab, which is the same thing that happened before the list existed.
  for (const code of codes) {
    counts[code] = 0;
  }
  counts[ERP_INTERFACE_UNASSIGNED] = 0;

  for (const row of rows) {
    const target = resolveClaimInterfaceTarget(row.brandCode, interfaceByClaim);
    counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}

export function pickDefaultInterfaceTarget(
  counts: Record<string, number>,
  codes: readonly string[],
): string {
  for (const code of codes) {
    if ((counts[code] ?? 0) > 0) return code;
  }
  if ((counts[ERP_INTERFACE_UNASSIGNED] ?? 0) > 0) return ERP_INTERFACE_UNASSIGNED;
  return codes[0] ?? ERP_INTERFACE_UNASSIGNED;
}
