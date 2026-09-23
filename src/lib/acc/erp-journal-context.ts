import { listBrandAccounts } from "@/lib/acc/brand-account-service";
import { listBrandBranches } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches } from "@/lib/acc/brand-journal-batch-service";
import { getBrandErpConfigPage } from "@/lib/acc/brand-erp-config-service";
import { resolveEffectiveErpEnvironment } from "@/lib/acc/erp-environment";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
import { listErpInterfaceBrands } from "@/lib/acc/erp-interface-brands";
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

/**
 * `acc:journal-ctx:{Production|Sandbox}:{formCode}`.
 *
 * The environment arm is the CLAUDE.md rule — anything derived from a
 * form-pool read carries the environment in its key, because two viewers of
 * one route can resolve to different databases.
 *
 * The form arm is the same rule for the same reason. Every table behind this
 * context now answers per form, so the context is a function of (environment,
 * form) and a key naming only the environment would serve AP-1's G/L accounts,
 * bank accounts, branch codes, journal batches, department G/L overrides and
 * interface mapping to whichever other form asked second — for sixty seconds,
 * silently, on the path that posts to Business Central.
 *
 * Both arms are closed enums or module constants, never user input, so the
 * `:` separator cannot be forged into a colliding key.
 */
function journalContextCacheKey(
  environment: ErpBcEnvironment,
  formCode: string,
): string {
  return `${JOURNAL_CONTEXT_CACHE_PREFIX}${environment}:${formCode}`;
}

/**
 * Bust cached journal build context after ERP account / branch settings change.
 *
 * Prefix-wide, so it still clears every environment *and* every form. A
 * settings write is not scoped to the writer's own environment or form — the
 * editors write defaults, which answer every form that has no override — so
 * deleting one key would leave the rest of the matrix stale.
 */
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

  /* Over `erpPage.targetBrands` rather than the brand list, which keeps this
     function SYNCHRONOUS. It is the same set — `getBrandErpConfigPage` builds
     `targetBrands` from `listErpInterfaceBrands()` — and it is already in this
     function's hands, so awaiting a second read here would be a second answer
     to one question as well as making a pure mapper async. */
  return erpPage.targetBrands.map((iface) => {
    const code = iface.brandCode.toUpperCase();
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
      targetBrandName: target?.brandName ?? iface.brandName,
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

/**
 * Primary G/L, Bank, Branch, Journal Batch + Interface ERP group metadata,
 * resolved for `formCode`.
 *
 * `formCode` is required and has no default. Every value this builds decides
 * where a journal line lands in Business Central — the G/L account, the bank
 * account, the branch, the journal batch, the department dimension and the
 * claim-brand-to-target mapping — so a caller that cannot say which form it is
 * asking for cannot be given an answer. A default parameter here would be the
 * exact silent wrong-form read this feature exists to prevent: it would
 * type-check, it would return a plausible context, and it would post to another
 * form's dimension.
 *
 * The form code is not a new source of truth. Both callers take it from the
 * requests the context is about — see `sendErpInterfaceBatch`, whose batch
 * comes from `listErpPrepRows` and is pinned to AP-1 by `r.FormCode`.
 *
 * Two reads here deliberately take no form code:
 *
 * - `listErpDepartmentsForBrands` reads `Rocks_ERP_Data.ErpDimensionValue`, the
 *   ERP's own list of dimension values. It has no `FormCode` — it is which
 *   codes exist in Business Central, not which one this form should use.
 * - `getErpJournalDescriptionTemplate` reads the global `AppSetting` key, which
 *   is not one of the seven per-form configuration tables.
 */
export async function loadErpJournalBuildContext(
  formCode: string,
  /**
   * Which BC's per-brand configuration to build from. **Omitted, the
   * environment this request resolves to** — which is what every send and
   * every prep read does, and why the money path cannot build a journal from
   * the wrong half.
   *
   * The settings screens name it, because their routes are pinned to
   * Production in `ROUTE_RULES` while their PRO/UAT toggle decides which half
   * is on screen. Without it AP-4's UAT card reads "ครบแล้ว" off Production's
   * inherited defaults — a green tick over configuration that does not exist
   * in the company the UAT send would post into.
   *
   * The cache key already carries the environment, so an override selects a
   * different entry rather than poisoning the one the money path reads.
   */
  environment?: ErpBcEnvironment,
): Promise<ErpJournalBuildContext> {
  const erpEnvironment = environment ?? (await resolveEffectiveErpEnvironment());
  const cacheKey = journalContextCacheKey(erpEnvironment, formCode);
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
    getBrandErpConfigPage(formCode),
    listBrandAccounts("gl", null, formCode, erpEnvironment),
    listBrandAccounts("bank", null, formCode, erpEnvironment),
    listBrandBranches(null, formCode, erpEnvironment),
    listBrandJournalBatches(null, formCode, erpEnvironment),
    resolveAllErpTargetProfiles(formCode),
    listErpInterfaceBrands().then((bs) => listErpDepartmentsForBrands(bs.map((b) => b.id))),
  ]);

  const interfaceByClaim: Record<string, string> = {};
  for (const b of erpPage.brands) {
    const target = b.interfaceBrandCode?.trim().toUpperCase();
    if (target) interfaceByClaim[b.brandCode.toUpperCase()] = target;
  }

  const interfaceByClaimMap = new Map(Object.entries(interfaceByClaim));

  const deptGlOverridesByTargetMap = await loadDeptGlOverridesByTarget(
    interfaceByClaimMap,
    formCode,
  );
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
  for (const iface of erpPage.targetBrands) {
    const key = iface.brandCode.toUpperCase();
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
