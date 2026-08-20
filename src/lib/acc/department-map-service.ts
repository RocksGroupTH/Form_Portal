import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { listBrandErpInterfaceMaps } from "@/lib/acc/brand-erp-interface-map-service";
import {
  DepartmentMapBoundsError,
  boundLegacyClaimCodes,
  claimCodesForInterfaceTarget,
  legacyClaimPurgeError,
} from "@/lib/acc/department-map-guard";
import { ERP_INTERFACE_BRANDS, isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import { getCorePool, getDataPool, sql } from "@/lib/db/mssql";
import { getBrandConfig } from "@/lib/brand-config";
import {
  HR_DEPARTMENT_DIMENSION_CODE,
  getLastDimensionSync,
  listErpDimensionOptions,
  resolveBrandBcDimensionContext,
  syncBrandDimensionValues,
  type DimensionSyncResult,
  type ErpDimensionOption,
  type ErpSyncLogSummary,
} from "@/lib/erp/dimension-sync";
import {
  listDepartmentCodes,
  type DepartmentCodeRow,
} from "@/lib/hr/department-lookup";
import { listErpGlAccountOptions } from "@/lib/erp/account-sync";
import { invalidateErpJournalBuildContextCache } from "@/lib/acc/erp-journal-context";

export interface DepartmentMappingRow {
  departmentCode: string;
  departmentName: string | null;
  erpDimensionCode: string;
  erpCode: string | null;
  erpDisplayName: string | null;
  mappedAt: string | null;
  fixedGlAccountNo: string | null;
  fixedGlDescription: string | null;
}

export interface GlOption {
  accountNo: string;
  displayName: string | null;
}

export interface ClaimBrandRef {
  claimBrandCode: string;
  brandName: string;
  brandLogo: string | null;
}

export interface TargetDepartmentMappingGroup {
  targetBrandCode: string;
  targetBrandName: string | null;
  targetBrandLogo: string | null;
  claimBrands: ClaimBrandRef[];
  bcConfigReady: boolean;
  dimensionCode: string;
  erpOptions: ErpDimensionOption[];
  glOptions: GlOption[];
  mappings: DepartmentMappingRow[];
  mappedCount: number;
  totalCount: number;
  lastSync: ErpSyncLogSummary | null;
}

/** @deprecated use TargetDepartmentMappingGroup */
export interface BrandDepartmentMappingSection {
  claimBrandCode: string;
  brandName: string;
  brandLogo: string | null;
  targetBrandCode: string | null;
  targetBrandName: string | null;
  bcConfigReady: boolean;
  dimensionCode: string;
  erpOptions: ErpDimensionOption[];
  mappings: DepartmentMappingRow[];
  mappedCount: number;
  totalCount: number;
  lastSync: ErpSyncLogSummary | null;
}

export interface MultiBrandDepartmentMappingPageData {
  dimensionCode: string;
  groups: TargetDepartmentMappingGroup[];
  unassignedClaims: ClaimBrandRef[];
}

/** @deprecated single-brand shape — use MultiBrandDepartmentMappingPageData */
export interface DepartmentMappingPageData {
  brandCode: string;
  dimensionCode: string;
  bcConfigReady: boolean;
  departments: DepartmentCodeRow[];
  erpOptions: ErpDimensionOption[];
  mappings: DepartmentMappingRow[];
  lastSync: ErpSyncLogSummary | null;
}

async function loadMappings(storageBrandCode: string): Promise<DepartmentMappingRow[]> {
  const pool = await getCorePool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, storageBrandCode.trim().toUpperCase())
    .query(`
      SELECT DepartmentCode, HrDepartmentName AS DepartmentName, ErpDimensionCode, ErpCode,
        FixedGlAccountNo, FixedGlDescription, MappedAt
      FROM [dbo].[DepartmentErpMap]
      WHERE BrandCode = @brand
    `);

  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    departmentCode: r.DepartmentCode as string,
    departmentName: (r.DepartmentName as string) ?? null,
    erpDimensionCode: r.ErpDimensionCode as string,
    erpCode: r.ErpCode as string,
    erpDisplayName: null,
    mappedAt: r.MappedAt ? (r.MappedAt as Date).toISOString() : null,
    fixedGlAccountNo: (r.FixedGlAccountNo as string) ?? null,
    fixedGlDescription: (r.FixedGlDescription as string) ?? null,
  }));
}

/** Load mappings stored under target brand, with legacy fallback from claim-brand rows. */
async function loadMappingsForTarget(
  targetBrandCode: string,
  legacyClaimCodes: string[],
): Promise<DepartmentMappingRow[]> {
  const target = targetBrandCode.trim().toUpperCase();
  const primary = await loadMappings(target);
  if (primary.length > 0) return primary;

  for (const claim of legacyClaimCodes) {
    const code = claim.trim().toUpperCase();
    if (!code || code === target) continue;
    const legacy = await loadMappings(code);
    if (legacy.length > 0) return legacy;
  }
  return [];
}

/**
 * Delete the legacy rows for a bounded set of claim brands.
 *
 * `codes` must already have come through `boundLegacyClaimCodes` — this
 * function does no filtering of its own, deliberately, so there is one place
 * that decides what may be deleted rather than two that disagree.
 */
async function purgeLegacyClaimMappings(codes: string[]): Promise<void> {
  const pool = await getCorePool();
  for (const code of codes) {
    await pool.request()
      .input("brand", sql.NVarChar, code)
      .query(`DELETE FROM [dbo].[DepartmentErpMap] WHERE BrandCode = @brand`);
  }
}

function mergeDepartmentMappings(
  codes: DepartmentCodeRow[],
  mappings: DepartmentMappingRow[],
  erpOptions: ErpDimensionOption[],
  dimensionCode: string,
): DepartmentMappingRow[] {
  const erpByCode = new Map(erpOptions.map((o) => [o.code, o.displayName]));

  return codes.map((c) => {
    const existing = mappings.find((m) => m.departmentCode === c.code);
    if (!existing) {
      return {
        departmentCode: c.code,
        departmentName: c.name,
        erpDimensionCode: dimensionCode,
        erpCode: null,
        erpDisplayName: null,
        mappedAt: null,
        fixedGlAccountNo: null,
        fixedGlDescription: null,
      };
    }
    return {
      ...existing,
      departmentName: c.name,
      erpDisplayName: existing.erpCode ? (erpByCode.get(existing.erpCode) ?? null) : null,
    };
  });
}

export async function isBrandBcDeptConfigReady(brandCode: string): Promise<boolean> {
  try {
    await resolveBrandBcDimensionContext(brandCode, HR_DEPARTMENT_DIMENSION_CODE);
    return true;
  } catch {
    return false;
  }
}

export async function getMultiBrandDepartmentMappingPage(): Promise<MultiBrandDepartmentMappingPageData> {
  const dimensionCode = HR_DEPARTMENT_DIMENSION_CODE;
  const [departmentCodes, allowedBrands, interfaceMaps] = await Promise.all([
    listDepartmentCodes(),
    getAllowedBrands(AP1_FORM_CODE),
    listBrandErpInterfaceMaps(),
  ]);

  const interfaceByClaim = new Map(
    interfaceMaps.map((m) => [m.brandCode.toUpperCase(), m.interfaceBrandCode.toUpperCase()]),
  );

  const claimsByTarget = new Map<string, ClaimBrandRef[]>();
  const unassignedClaims: ClaimBrandRef[] = [];

  for (const claim of allowedBrands) {
    const claimCode = claim.brandCode.toUpperCase();
    const ref: ClaimBrandRef = {
      claimBrandCode: claimCode,
      brandName: claim.brandName,
      brandLogo: claim.brandLogo,
    };
    const target = interfaceByClaim.get(claimCode) ?? null;
    if (!target) {
      unassignedClaims.push(ref);
      continue;
    }
    const list = claimsByTarget.get(target) ?? [];
    list.push(ref);
    claimsByTarget.set(target, list);
  }

  const targetCodes = Array.from(claimsByTarget.keys());
  const groups: TargetDepartmentMappingGroup[] = await Promise.all(
    targetCodes.map(async (targetBrandCode) => {
      const claimBrands = claimsByTarget.get(targetBrandCode) ?? [];
      const legacyClaimCodes = claimBrands.map((c) => c.claimBrandCode);

      const [savedMappings, erpOptions, glAccounts, lastSync, bcConfigReady, targetCfg] = await Promise.all([
        loadMappingsForTarget(targetBrandCode, legacyClaimCodes),
        listErpDimensionOptions(targetBrandCode, dimensionCode),
        listErpGlAccountOptions(targetBrandCode),
        getLastDimensionSync(targetBrandCode),
        isBrandBcDeptConfigReady(targetBrandCode),
        getBrandConfig(targetBrandCode),
      ]);
      const glOptions: GlOption[] = glAccounts.map((a) => ({
        accountNo: a.accountNo,
        displayName: a.displayName,
      }));

      const mappings = mergeDepartmentMappings(
        departmentCodes,
        savedMappings,
        erpOptions,
        dimensionCode,
      );
      const mappedCount = mappings.filter((m) => m.erpCode?.trim()).length;

      return {
        targetBrandCode,
        targetBrandName: targetCfg?.brandName ?? targetBrandCode,
        targetBrandLogo: targetCfg?.brandLogo ?? `/brandlogo/${targetBrandCode.toLowerCase()}-200.png`,
        claimBrands,
        bcConfigReady,
        dimensionCode,
        erpOptions,
        glOptions,
        mappings,
        mappedCount,
        totalCount: mappings.length,
        lastSync,
      };
    }),
  );

  groups.sort((a, b) => a.targetBrandCode.localeCompare(b.targetBrandCode));

  return { dimensionCode, groups, unassignedClaims };
}

/** Legacy single-page loader (first brand section) — kept for internal compatibility. */
export async function getDepartmentMappingPage(): Promise<DepartmentMappingPageData> {
  const page = await getMultiBrandDepartmentMappingPage();
  const first = page.groups[0];
  const departments = await listDepartmentCodes();

  if (!first) {
    return {
      brandCode: "PCTH",
      dimensionCode: page.dimensionCode,
      bcConfigReady: false,
      departments,
      erpOptions: [],
      mappings: [],
      lastSync: null,
    };
  }

  return {
    brandCode: first.targetBrandCode,
    dimensionCode: first.dimensionCode,
    bcConfigReady: first.bcConfigReady,
    departments,
    erpOptions: first.erpOptions,
    mappings: first.mappings,
    lastSync: first.lastSync,
  };
}

export interface SaveDepartmentMappingInput {
  departmentCode: string;
  departmentName?: string | null;
  erpCode: string | null;
  erpDimensionCode?: string;
  fixedGlAccountNo?: string | null;
  fixedGlDescription?: string | null;
}

export async function saveDepartmentMappings(
  targetBrandCode: string,
  items: SaveDepartmentMappingInput[],
  userId: number,
  legacyClaimCodes: string[] = [],
): Promise<void> {
  const brandCode = targetBrandCode.trim().toUpperCase();
  if (!brandCode) throw new DepartmentMapBoundsError("กรุณาระบุแบรนด์ปลายทาง");
  // The target names which brand's rows this whole call writes and deletes, so
  // it is bounded to the four brands that can actually be an ERP interface
  // target — the same test `upsertBrandErpInterfaceMap` applies when the
  // claim → target map is written, so every real target already passes.
  if (!isErpInterfaceBrandCode(brandCode)) {
    throw new DepartmentMapBoundsError("แบรนด์ปลายทางต้องเป็น PCTH, KSI, PCMY หรือ UNO");
  }

  // Bound the purge *before* the first upsert. `legacyClaimCodes` is
  // client-supplied and each entry becomes a whole-brand DELETE against
  // `DepartmentErpMap` in the shared configuration database; validating it
  // after the writes would leave a refused request half-applied. See
  // `department-map-guard.ts` for what the list is and why it is dangerous.
  //
  // The bound is this target's own claim brands, read from
  // `AccBrandErpInterface` — the same set `getMultiBrandDepartmentMappingPage`
  // groups by and the dialog sends back. Not the AP-1 allowlist: that contains
  // every claim brand, so it would leave one PUT able to empty the table for
  // every brand but the target, which is the whole thing this bound exists to
  // stop.
  let purgeCodes: string[] = [];
  const requestedPurge = Array.isArray(legacyClaimCodes) ? legacyClaimCodes : [];
  if (requestedPurge.length > 0) {
    const purgeable = claimCodesForInterfaceTarget(
      await listBrandErpInterfaceMaps(),
      brandCode,
    );
    const bounds = boundLegacyClaimCodes(requestedPurge, brandCode, purgeable);
    if (bounds.rejected.length > 0) {
      throw new DepartmentMapBoundsError(legacyClaimPurgeError(bounds.rejected));
    }
    purgeCodes = bounds.codes;
  }

  const dimensionCode = HR_DEPARTMENT_DIMENSION_CODE;
  const pool = await getCorePool();

  for (const item of items) {
    const departmentCode = item.departmentCode.trim();
    const erpCode = item.erpCode?.trim() || null;
    const fixedGlAccountNo = item.fixedGlAccountNo?.trim() || null;
    const fixedGlDescription = item.fixedGlDescription?.trim() || null;

    if (!erpCode && !fixedGlAccountNo) {
      await pool
        .request()
        .input("brand", sql.NVarChar, brandCode)
        .input("code", sql.NVarChar, departmentCode)
        .query(`
          DELETE FROM [dbo].[DepartmentErpMap]
          WHERE BrandCode = @brand AND DepartmentCode = @code
        `);
      continue;
    }

    const erpDim = item.erpDimensionCode?.trim() || dimensionCode;
    await pool
      .request()
      .input("brand", sql.NVarChar, brandCode)
      .input("code", sql.NVarChar, departmentCode)
      .input("deptName", sql.NVarChar, item.departmentName?.trim() || null)
      .input("erpDim", sql.NVarChar, erpDim)
      // ErpCode remains NVARCHAR(50) NOT NULL on DepartmentErpMap (migration 045 only
      // added FixedGl* columns) — persist "" rather than NULL for a GL-only override row.
      // Every downstream reader already treats "" as absent (falsy checks / <> '' filters).
      .input("erpCode", sql.NVarChar, erpCode ?? "")
      .input("fixedGlAccountNo", sql.NVarChar, fixedGlAccountNo)
      .input("fixedGlDescription", sql.NVarChar, fixedGlDescription)
      .input("by", sql.Int, userId || null)
      // Full-row upsert: this MERGE unconditionally overwrites FixedGlAccountNo/
      // FixedGlDescription (and ErpCode) on every matched row, so callers must send
      // those fields from a hydrated draft — a partial payload omitting them will
      // null them out. Current sole caller (dept-mapping dialog) always sends the
      // full per-row draft (ERP dept + Fixed G/L + description together) and only
      // includes rows that actually changed, so this is safe today.
      .query(`
        MERGE [dbo].[DepartmentErpMap] AS t
        USING (SELECT @brand AS BrandCode, @code AS DepartmentCode) AS s
        ON t.BrandCode = s.BrandCode AND t.DepartmentCode = s.DepartmentCode
        WHEN MATCHED THEN
          UPDATE SET
            HrDepartmentName = @deptName,
            ErpDimensionCode = @erpDim,
            ErpCode = @erpCode,
            FixedGlAccountNo = @fixedGlAccountNo,
            FixedGlDescription = @fixedGlDescription,
            MappedBy = @by,
            MappedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (
            BrandCode, DepartmentCode, HrDepartmentName, ErpDimensionCode, ErpCode,
            FixedGlAccountNo, FixedGlDescription, MappedBy
          )
          VALUES (
            @brand, @code, @deptName, @erpDim, @erpCode,
            @fixedGlAccountNo, @fixedGlDescription, @by
          );
      `);
  }

  if (purgeCodes.length > 0) {
    await purgeLegacyClaimMappings(purgeCodes);
  }

  invalidateErpJournalBuildContextCache();
}

export interface SyncAllDepartmentsResult {
  results: DimensionSyncResult[];
  errors: { brandCode: string; error: string }[];
  totalRows: number;
}

/** Sync DEPT dimension values for every Brand Config ERP brand (PCTH, KSI, PCMY, UNO). */
export async function syncAllBrandDepartmentDimensions(
  triggeredBy: number | null,
): Promise<SyncAllDepartmentsResult> {
  const results: DimensionSyncResult[] = [];
  const errors: { brandCode: string; error: string }[] = [];
  let totalRows = 0;

  for (const brand of ERP_INTERFACE_BRANDS) {
    try {
      const r = await syncBrandDimensionValues(
        brand.id,
        HR_DEPARTMENT_DIMENSION_CODE,
        triggeredBy,
      );
      results.push(r);
      totalRows += r.rowsUpserted;
    } catch (e) {
      errors.push({
        brandCode: brand.id,
        error: e instanceof Error ? e.message : "Sync failed",
      });
    }
  }

  return { results, errors, totalRows };
}

/** Sync DEPT dimension values for a single ERP interface brand. */
export async function syncBrandDepartmentDimension(
  brandCode: string,
  triggeredBy: number | null,
): Promise<DimensionSyncResult> {
  return syncBrandDimensionValues(brandCode, HR_DEPARTMENT_DIMENSION_CODE, triggeredBy);
}

/** Load HR dept → ERP code maps keyed by target (interface) brand. */
export async function loadDepartmentErpMapsByTarget(
  interfaceByClaim: Map<string, string>,
): Promise<Map<string, Map<string, string>>> {
  const pool = await getCorePool();
  const res = await pool.request().query(`
    SELECT BrandCode, DepartmentCode, ErpCode
    FROM [dbo].[DepartmentErpMap]
    WHERE ErpCode IS NOT NULL AND LTRIM(RTRIM(ErpCode)) <> ''
  `);

  const rawByKey = new Map<string, Map<string, string>>();
  for (const r of res.recordset as { BrandCode: string; DepartmentCode: string; ErpCode: string }[]) {
    const key = r.BrandCode.toUpperCase();
    if (!rawByKey.has(key)) rawByKey.set(key, new Map());
    rawByKey.get(key)!.set(r.DepartmentCode.trim(), r.ErpCode);
  }

  const claimsByTarget = new Map<string, string[]>();
  for (const [claim, target] of Array.from(interfaceByClaim.entries())) {
    const list = claimsByTarget.get(target) ?? [];
    list.push(claim);
    claimsByTarget.set(target, list);
  }

  const out = new Map<string, Map<string, string>>();
  const targetKeys = new Set<string>(Array.from(claimsByTarget.keys()));
  for (const key of Array.from(rawByKey.keys())) {
    targetKeys.add(key);
  }

  for (const target of Array.from(targetKeys)) {
    let map = rawByKey.get(target);
    if (!map) {
      const claims = claimsByTarget.get(target) ?? [];
      for (const claim of claims) {
        const legacy = rawByKey.get(claim);
        if (legacy && legacy.size > 0) {
          map = legacy;
          break;
        }
      }
    }
    if (map) out.set(target, map);
  }

  return out;
}

export interface DeptGlOverride {
  accountNo: string;
  description: string;
}

/** Load HR dept → Fixed G/L override maps keyed by target (interface) brand. */
export async function loadDeptGlOverridesByTarget(
  interfaceByClaim: Map<string, string>,
): Promise<Map<string, Map<string, DeptGlOverride>>> {
  const pool = await getCorePool();
  const res = await pool.request().query(`
    SELECT BrandCode, DepartmentCode, FixedGlAccountNo, FixedGlDescription
    FROM [dbo].[DepartmentErpMap]
    WHERE FixedGlAccountNo IS NOT NULL AND LTRIM(RTRIM(FixedGlAccountNo)) <> ''
  `);

  const rawByKey = new Map<string, Map<string, DeptGlOverride>>();
  for (const r of res.recordset as {
    BrandCode: string;
    DepartmentCode: string;
    FixedGlAccountNo: string;
    FixedGlDescription: string | null;
  }[]) {
    const key = r.BrandCode.toUpperCase();
    if (!rawByKey.has(key)) rawByKey.set(key, new Map());
    rawByKey.get(key)!.set(r.DepartmentCode.trim(), {
      accountNo: r.FixedGlAccountNo.trim(),
      description: (r.FixedGlDescription ?? "").trim(),
    });
  }

  const claimsByTarget = new Map<string, string[]>();
  for (const [claim, target] of Array.from(interfaceByClaim.entries())) {
    const list = claimsByTarget.get(target) ?? [];
    list.push(claim);
    claimsByTarget.set(target, list);
  }

  const out = new Map<string, Map<string, DeptGlOverride>>();
  const targetKeys = new Set<string>(Array.from(claimsByTarget.keys()));
  for (const key of Array.from(rawByKey.keys())) {
    targetKeys.add(key);
  }

  for (const target of Array.from(targetKeys)) {
    let map = rawByKey.get(target);
    if (!map) {
      const claims = claimsByTarget.get(target) ?? [];
      for (const claim of claims) {
        const legacy = rawByKey.get(claim);
        if (legacy && legacy.size > 0) {
          map = legacy;
          break;
        }
      }
    }
    if (map) out.set(target, map);
  }

  return out;
}

/** @deprecated use loadDepartmentErpMapsByTarget */
export async function loadAllDepartmentErpMaps(): Promise<Map<string, Map<string, string>>> {
  const pool = await getCorePool();
  const res = await pool.request().query(`
    SELECT BrandCode, DepartmentCode, ErpCode
    FROM [dbo].[DepartmentErpMap]
    WHERE ErpCode IS NOT NULL AND LTRIM(RTRIM(ErpCode)) <> ''
  `);

  const out = new Map<string, Map<string, string>>();
  for (const r of res.recordset as { BrandCode: string; DepartmentCode: string; ErpCode: string }[]) {
    const brand = r.BrandCode.toUpperCase();
    if (!out.has(brand)) out.set(brand, new Map());
    out.get(brand)!.set(r.DepartmentCode, r.ErpCode);
  }
  return out;
}

/** ERP dept display names keyed by target (interface) brand. */
export async function loadErpDeptDisplayNamesByTargetBrand(): Promise<Map<string, Map<string, string>>> {
  const pool = await getDataPool();
  const targetBrands = ERP_INTERFACE_BRANDS.map((b) => b.id);
  const out = new Map<string, Map<string, string>>();

  await Promise.all(
    targetBrands.map(async (target) => {
      const res = await pool
        .request()
        .input("brand", sql.NVarChar, target)
        .input("dim", sql.NVarChar, HR_DEPARTMENT_DIMENSION_CODE)
        .query(`
          SELECT Code, DisplayName
          FROM [dbo].[ErpDimensionValue]
          WHERE BrandCode = @brand AND DimensionCode = @dim AND IsActive = 1
        `);

      const map = new Map<string, string>();
      for (const r of res.recordset as { Code: string; DisplayName: string | null }[]) {
        map.set(r.Code, r.DisplayName ?? r.Code);
      }
      out.set(target, map);
    }),
  );

  return out;
}
