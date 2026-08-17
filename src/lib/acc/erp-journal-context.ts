import { listBrandAccounts } from "@/lib/acc/brand-account-service";
import { listBrandBranches } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches } from "@/lib/acc/brand-journal-batch-service";
import { getBrandErpConfigPage } from "@/lib/acc/brand-erp-config-service";
import { resolveEffectiveErpEnvironment } from "@/lib/acc/erp-environment";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import { listErpDepartmentsForBrands } from "@/lib/erp/dimension-sync";
import { loadDeptGlOverridesByTarget } from "@/lib/acc/department-map-service";
import {
  formatErpTargetProfileMeta,
  resolveAllErpTargetProfiles,
} from "@/lib/acc/erp-target-profile";
import {
  DEFAULT_ERP_JOURNAL_DESC_TEMPLATE,
  ERP_JOURNAL_DESC_TEMPLATE_KEY,
  normalizeErpJournalDescTemplate,
} from "@/lib/acc/erp-journal-description";
import type {
  BrandErpAccountConfig,
  ErpInterfaceClaimChip,
  ErpInterfaceTargetMeta,
  ErpJournalBuildContext,
} from "@/lib/acc/erp-journal-builder";
import { getSetting, setSetting } from "@/lib/acc/settings-service";
import { getAccCached, putAccCached, deleteAccCachedByPrefix } from "@/lib/acc/acc-cache";

const JOURNAL_CONTEXT_CACHE_PREFIX = "acc:journal-ctx:";
const JOURNAL_CONTEXT_CACHE_TTL_MS = 60_000;

function journalContextCacheKey(environment: ErpBcEnvironment): string {
  return `${JOURNAL_CONTEXT_CACHE_PREFIX}${environment}`;
}

/** Bust cached journal build context after ERP account / branch settings change. */
export function invalidateErpJournalBuildContextCache(): void {
  deleteAccCachedByPrefix(JOURNAL_CONTEXT_CACHE_PREFIX);
}

function primaryByBrand<T extends { brandCode: string; isActive: boolean; sortOrder: number; id: number }>(
  rows: T[],
): Record<string, T> {
  const map: Record<string, T> = {};
  const sorted = Array.from(rows).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const r of sorted) {
    if (!r.isActive) continue;
    const key = r.brandCode.toUpperCase();
    if (!map[key]) map[key] = r;
  }
  return map;
}

function resolveJournalBatchName(
  claimBrand: string,
  interfaceByClaim: Map<string, string>,
  journalByBrand: Record<string, { batchName: string }>,
): string | null {
  const claim = claimBrand.toUpperCase();
  const target = interfaceByClaim.get(claim);
  if (target) {
    const targetRow = journalByBrand[target];
    if (targetRow?.batchName?.trim()) return targetRow.batchName.trim();
  }
  const claimRow = journalByBrand[claim];
  return claimRow?.batchName?.trim() ?? null;
}

function formatBcMeta(
  bcName: string | null | undefined,
  connectCode: string | null | undefined,
  connectName: string | null | undefined,
): string | null {
  const parts = [bcName?.trim(), connectCode?.trim(), connectName?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildTargetMeta(
  erpPage: Awaited<ReturnType<typeof getBrandErpConfigPage>>,
  journalMap: Record<string, { batchName: string }>,
  profiles: Awaited<ReturnType<typeof resolveAllErpTargetProfiles>>,
): ErpInterfaceTargetMeta[] {
  const targetByCode = new Map(
    erpPage.targetBrands.map((t) => [t.brandCode.toUpperCase(), t]),
  );
  const profileByCode = new Map(profiles.map((p) => [p.interfaceBrandCode, p]));

  return ERP_INTERFACE_BRANDS.map((iface) => {
    const code = iface.id.toUpperCase();
    const target = targetByCode.get(code);
    const profile = profileByCode.get(code);
    const claimBrands: ErpInterfaceClaimChip[] = erpPage.brands
      .filter((b) => (b.interfaceBrandCode ?? "").toUpperCase() === code)
      .map((b) => ({
        brandCode: b.brandCode,
        brandName: b.brandName,
        brandLogo: b.brandLogo,
      }));

    const journalRow = journalMap[code];
    const bcMeta = profile
      ? formatErpTargetProfileMeta(profile)
      : formatBcMeta(target?.bcName, target?.bcConnectionCode, target?.bcConnectionName);

    return {
      targetBrandCode: code,
      targetBrandName: target?.brandName ?? iface.name,
      targetBrandLogo: `/brandlogo/${code.toLowerCase()}-200.png`,
      claimBrands,
      journalBatchName: journalRow?.batchName?.trim() ?? null,
      bcMeta,
      bcEnvironment: profile?.environment ?? "Production",
      bcProfileComplete: profile?.profileComplete ?? false,
    };
  });
}

export async function getErpJournalDescriptionTemplate(): Promise<string> {
  const raw = await getSetting(ERP_JOURNAL_DESC_TEMPLATE_KEY);
  return normalizeErpJournalDescTemplate(raw ?? DEFAULT_ERP_JOURNAL_DESC_TEMPLATE);
}

export async function saveErpJournalDescriptionTemplate(
  template: string,
  userId: number,
): Promise<string> {
  const normalized = normalizeErpJournalDescTemplate(template);
  await setSetting(ERP_JOURNAL_DESC_TEMPLATE_KEY, normalized, userId);
  return normalized;
}

/** Primary G/L, Bank, Branch, Journal Batch + Interface ERP group metadata. */
export async function loadErpJournalBuildContext(): Promise<ErpJournalBuildContext> {
  const erpEnvironment = await resolveEffectiveErpEnvironment();
  const cacheKey = journalContextCacheKey(erpEnvironment);
  const cached = getAccCached<ErpJournalBuildContext>(cacheKey, JOURNAL_CONTEXT_CACHE_TTL_MS);
  if (cached) return cached;

  const [
    descriptionTemplate,
    erpPage,
    glRows,
    bankRows,
    branchRows,
    journalRows,
    profiles,
    erpDepartmentsByTarget,
  ] = await Promise.all([
    getErpJournalDescriptionTemplate(),
    getBrandErpConfigPage(),
    listBrandAccounts("gl"),
    listBrandAccounts("bank"),
    listBrandBranches(),
    listBrandJournalBatches(),
    resolveAllErpTargetProfiles(),
    listErpDepartmentsForBrands(ERP_INTERFACE_BRANDS.map((b) => b.id)),
  ]);

  const interfaceByClaim: Record<string, string> = {};
  for (const b of erpPage.brands) {
    const target = b.interfaceBrandCode?.trim().toUpperCase();
    if (target) interfaceByClaim[b.brandCode.toUpperCase()] = target;
  }

  const interfaceByClaimMap = new Map(Object.entries(interfaceByClaim));

  const deptGlOverridesByTargetMap = await loadDeptGlOverridesByTarget(interfaceByClaimMap);
  const deptGlOverridesByTarget: Record<string, Record<string, { accountNo: string; description: string }>> = {};
  for (const [target, deptMap] of Array.from(deptGlOverridesByTargetMap.entries())) {
    const inner: Record<string, { accountNo: string; description: string }> = {};
    for (const [departmentCode, override] of Array.from(deptMap.entries())) {
      inner[departmentCode] = override;
    }
    deptGlOverridesByTarget[target] = inner;
  }

  const glMap = primaryByBrand(glRows);
  const bankMap = primaryByBrand(bankRows);
  const branchMap = primaryByBrand(branchRows);
  const journalMap = primaryByBrand(journalRows);

  const brandCodes = new Set<string>();
  for (const key of Object.keys(glMap)) brandCodes.add(key);
  for (const key of Object.keys(bankMap)) brandCodes.add(key);
  for (const key of Object.keys(branchMap)) brandCodes.add(key);
  for (const b of erpPage.brands) brandCodes.add(b.brandCode.toUpperCase());

  const erpDeptCodesByTarget: Record<string, string[]> = {};
  for (const iface of ERP_INTERFACE_BRANDS) {
    const key = iface.id.toUpperCase();
    erpDeptCodesByTarget[key] = (erpDepartmentsByTarget[key] ?? []).map((d) => d.code);
  }

  const brandAccounts: Record<string, BrandErpAccountConfig> = {};
  for (const code of Array.from(brandCodes)) {
    const gl = glMap[code];
    const bank = bankMap[code];
    const branch = branchMap[code];
    brandAccounts[code] = {
      glAccountNo: gl?.accountNo?.trim() ?? null,
      erpDescription: gl?.erpDescription?.trim() ?? gl?.displayName?.trim() ?? null,
      bankAccountNo: bank?.accountNo?.trim() ?? null,
      branchCode: branch?.branchCode?.trim() ?? null,
      journalBatchName: resolveJournalBatchName(code, interfaceByClaimMap, journalMap),
      deptAsBranch: !!(branch?.deptAsBranch || branch?.fixedErpDeptCode?.trim()),
      fixedErpDeptCode: branch?.fixedErpDeptCode?.trim() ?? null,
    };
  }

  const targetMeta = buildTargetMeta(erpPage, journalMap, profiles);

  const result: ErpJournalBuildContext = {
    descriptionTemplate,
    brandAccounts,
    interfaceByClaim,
    targetMeta,
    erpDeptCodesByTarget,
    deptGlOverridesByTarget,
    erpEnvironment,
  };
  putAccCached(cacheKey, result);
  return result;
}
