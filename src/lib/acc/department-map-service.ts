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
import {
  defaultsOnly,
  perFormOrderBy,
  perFormPredicate,
  perFormWriteMatch,
  pickAllForForm,
} from "@/lib/acc/per-form-config";
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

/**
 * A `DepartmentErpMap` row as stored, before the default/override rule reduces
 * it to the one row that answers for a form.
 *
 * Migration 098 gave the table a `FormCode`, so a brand can now hold a default
 * row (`NULL`) *and* one row per form for the same department. Every read has
 * to say which of them it wants; none of them may simply take what the driver
 * hands back first.
 */
interface StoredDepartmentMappingRow extends DepartmentMappingRow {
  /** `null` is the default, which answers every form. Never left absent. */
  formCode: string | null;
}

/**
 * Drop `formCode` on the way out.
 *
 * The pick has already happened, so the surviving row's own form code carries
 * no information the caller can act on — and the editor renders these rows, so
 * a field that is always `null` there would read as "no form", not "default".
 */
function withoutFormCode(row: StoredDepartmentMappingRow): DepartmentMappingRow {
  return {
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    erpDimensionCode: row.erpDimensionCode,
    erpCode: row.erpCode,
    erpDisplayName: row.erpDisplayName,
    mappedAt: row.mappedAt,
    fixedGlAccountNo: row.fixedGlAccountNo,
    fixedGlDescription: row.fixedGlDescription,
  };
}

/**
 * One brand's department mappings, resolved for `formCode`.
 *
 * `formCode` is required rather than optional: this is the read behind the
 * settings editor *and* the shape every future caller will copy, and an
 * omitted argument here is the one that silently returns another form's row.
 * `null` means the default — what an editor with no form selector edits.
 */
async function loadMappings(
  storageBrandCode: string,
  formCode: string | null,
): Promise<DepartmentMappingRow[]> {
  const pool = await getCorePool();
  const req = pool
    .request()
    .input("brand", sql.NVarChar, storageBrandCode.trim().toUpperCase());
  let formWhere = "AND FormCode IS NULL";
  if (formCode) {
    req.input("formCode", sql.NVarChar(20), formCode);
    formWhere = `AND ${perFormPredicate()}`;
  }
  const res = await req.query(`
      SELECT DepartmentCode, HrDepartmentName AS DepartmentName, ErpDimensionCode, ErpCode,
        FixedGlAccountNo, FixedGlDescription, MappedAt, FormCode
      FROM [dbo].[DepartmentErpMap]
      WHERE BrandCode = @brand ${formWhere}
      ORDER BY ${perFormOrderBy()}
    `);

  const rows: StoredDepartmentMappingRow[] = (res.recordset as Record<string, unknown>[]).map(
    (r) => ({
      departmentCode: r.DepartmentCode as string,
      departmentName: (r.DepartmentName as string) ?? null,
      erpDimensionCode: r.ErpDimensionCode as string,
      erpCode: r.ErpCode as string,
      erpDisplayName: null,
      mappedAt: r.MappedAt ? (r.MappedAt as Date).toISOString() : null,
      fixedGlAccountNo: (r.FixedGlAccountNo as string) ?? null,
      fixedGlDescription: (r.FixedGlDescription as string) ?? null,
      // SQL NULL becomes `null`, never `undefined`: an absent property is
      // invisible to both pickAllForForm and defaultsOnly, which would drop
      // this brand's entire default mapping without an error.
      formCode: (r.FormCode as string | null) ?? null,
    }),
  );

  // The unique index is (FormCode, BrandCode, DepartmentCode) and BrandCode is
  // already pinned by the WHERE, so the pick unit is the department code.
  // Trimmed, because SQL Server compares trailing blanks as equal and the index
  // therefore cannot hold 'IT' and 'IT ' side by side.
  const picked = formCode
    ? pickAllForForm(rows, formCode, (row) => row.departmentCode.trim())
    : defaultsOnly(rows);
  return picked.map(withoutFormCode);
}

/** Load mappings stored under target brand, with legacy fallback from claim-brand rows. */
async function loadMappingsForTarget(
  targetBrandCode: string,
  legacyClaimCodes: string[],
  formCode: string | null,
): Promise<DepartmentMappingRow[]> {
  const target = targetBrandCode.trim().toUpperCase();
  const primary = await loadMappings(target, formCode);
  if (primary.length > 0) return primary;

  for (const claim of legacyClaimCodes) {
    const code = claim.trim().toUpperCase();
    if (!code || code === target) continue;
    const legacy = await loadMappings(code, formCode);
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
 *
 * There are now *two* bounds and they compose: `codes` says which brands, and
 * `formCode` says which of each brand's rows. The second is not optional —
 * unbounded, clearing the default for a claim brand takes every form's override
 * for that brand with it, in one statement, with no error.
 */
async function purgeLegacyClaimMappings(
  codes: string[],
  formCode: string | null,
): Promise<void> {
  const pool = await getCorePool();
  for (const code of codes) {
    const req = pool.request().input("brand", sql.NVarChar, code);
    if (formCode) req.input("formCode", sql.NVarChar(20), formCode);
    await req.query(`
      DELETE FROM [dbo].[DepartmentErpMap]
      WHERE BrandCode = @brand AND ${perFormWriteMatch(formCode)}
    `);
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

/**
 * The settings editor's view of the department map — **the defaults, always.**
 *
 * Deliberately not per-form, and deliberately without a `formCode` parameter.
 * The แผนก tab has no form selector, so the only honest thing it can show is
 * the shared configuration: a merged per-form view would let an admin edit
 * AP-4's override believing it was the default. `saveDepartmentMappings` is
 * given the matching `null` by its route, so what this page reads is exactly
 * what that page writes.
 *
 * `listBrandErpInterfaceMaps()` is called with no form code for the same
 * reason — the groups on this page are the default claim → target mapping.
 */
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
        loadMappingsForTarget(targetBrandCode, legacyClaimCodes, null),
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

/**
 * Write one target brand's department mappings for one form.
 *
 * `formCode` is required and has no default. `null` is the shared default row —
 * what the admin editor saves — and a form code writes that form's override
 * alone. Every statement below is bounded by it through `perFormWriteMatch`,
 * including the two deletes: `FormCode = @formCode` never matches `NULL`, and
 * an unbounded `WHERE BrandCode = …` sweeps the default and every override for
 * the brand together, silently and in one statement.
 *
 * The parameter is last rather than beside `targetBrandCode` so the existing
 * argument order is undisturbed; `legacyClaimCodes` lost its `= []` default in
 * exchange, since a default it can never use only hides the decision.
 */
export async function saveDepartmentMappings(
  targetBrandCode: string,
  items: SaveDepartmentMappingInput[],
  userId: number,
  legacyClaimCodes: string[],
  formCode: string | null,
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
  //
  // Since migration 097 that set is itself per-form, so the interface map is
  // read for *this* save's form. The purge deletes this form's rows; the brands
  // it may delete them for must be the brands this form's interface map points
  // at the target, not another form's. `formCode === null` reads the defaults,
  // which is what the admin editor saves and is byte-for-byte today's answer.
  let purgeCodes: string[] = [];
  const requestedPurge = Array.isArray(legacyClaimCodes) ? legacyClaimCodes : [];
  if (requestedPurge.length > 0) {
    const purgeable = claimCodesForInterfaceTarget(
      await listBrandErpInterfaceMaps(formCode ?? undefined),
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
      // Bounded to this save's own row. Clearing a department on the default
      // means "no shared mapping"; without the form bound it also deletes every
      // form's override of that department, which is not what the editor asked
      // for and leaves no trace that it happened.
      const del = pool
        .request()
        .input("brand", sql.NVarChar, brandCode)
        .input("code", sql.NVarChar, departmentCode);
      if (formCode) del.input("formCode", sql.NVarChar(20), formCode);
      await del.query(`
          DELETE FROM [dbo].[DepartmentErpMap]
          WHERE BrandCode = @brand AND DepartmentCode = @code
            AND ${perFormWriteMatch(formCode)}
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
      // Always bound, even when null: `perFormWriteMatch(null)` renders
      // `FormCode IS NULL` and never names the parameter, but the INSERT arm
      // still has to write it, so it is bound unconditionally.
      .input("formCode", sql.NVarChar(20), formCode)
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
      //
      // The form bound belongs in the ON clause, not in a WHEN MATCHED AND: one
      // source row matching several target rows updates all of them, so an ON
      // of (BrandCode, DepartmentCode) alone would rewrite the default and every
      // form's override of that department with this one payload. It is also
      // correct for the NOT MATCHED arm — FormCode is the leading column of
      // UQ_DepartmentErpMap_Dept, so inserting the default beside an existing
      // override is a legal row, not a duplicate.
      .query(`
        MERGE [dbo].[DepartmentErpMap] AS t
        USING (SELECT @brand AS BrandCode, @code AS DepartmentCode) AS s
        ON t.BrandCode = s.BrandCode AND t.DepartmentCode = s.DepartmentCode
           AND ${perFormWriteMatch(formCode, "t")}
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
            BrandCode, DepartmentCode, FormCode, HrDepartmentName, ErpDimensionCode, ErpCode,
            FixedGlAccountNo, FixedGlDescription, MappedBy
          )
          VALUES (
            @brand, @code, @formCode, @deptName, @erpDim, @erpCode,
            @fixedGlAccountNo, @fixedGlDescription, @by
          );
      `);
  }

  if (purgeCodes.length > 0) {
    await purgeLegacyClaimMappings(purgeCodes, formCode);
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

/**
 * Load HR dept → ERP code maps keyed by target (interface) brand.
 *
 * **This is the read that decides which ERP dimension an approved claim posts
 * to.** With `formCode`, it resolves that form's configuration: the form's own
 * row for a department where it has one, the default otherwise. Without, the
 * defaults alone — the safe answer for a caller with no form in hand, since it
 * can never return another form's mapping.
 *
 * The value filter (`ErpCode` non-blank) runs **after** the pick, not in the
 * WHERE. Filtering first is a fallback in disguise: a form whose own row maps a
 * department to no dimension code — which `saveDepartmentMappings` stores as
 * `''` for a G/L-only row — would be filtered out of its own group and inherit
 * the default's dimension code instead of overriding it away. Today every row
 * is a default, so the two orders agree exactly; they stop agreeing the moment
 * anyone adds an override, and by then the money has a dimension on it.
 */
export async function loadDepartmentErpMapsByTarget(
  interfaceByClaim: Map<string, string>,
  formCode?: string,
): Promise<Map<string, Map<string, string>>> {
  const pool = await getCorePool();
  const req = pool.request();
  let formWhere = "WHERE FormCode IS NULL";
  if (formCode) {
    req.input("formCode", sql.NVarChar(20), formCode);
    formWhere = `WHERE ${perFormPredicate()}`;
  }
  const res = await req.query(`
    SELECT BrandCode, DepartmentCode, ErpCode, FormCode
    FROM [dbo].[DepartmentErpMap]
    ${formWhere}
    ORDER BY BrandCode, DepartmentCode, ${perFormOrderBy()}
  `);

  const rows = (
    res.recordset as {
      BrandCode: string;
      DepartmentCode: string;
      ErpCode: string | null;
      FormCode: string | null;
    }[]
  ).map((r) => ({
    brandCode: r.BrandCode.toUpperCase(),
    departmentCode: r.DepartmentCode.trim(),
    erpCode: r.ErpCode,
    // Never `undefined` — see the note in `loadMappings`.
    formCode: r.FormCode ?? null,
  }));

  // One row per (BrandCode, DepartmentCode): the unique index minus FormCode.
  // JSON.stringify rather than a separator character, so no ERP code can forge
  // a key collision.
  const resolved = formCode
    ? pickAllForForm(rows, formCode, (row) => JSON.stringify([row.brandCode, row.departmentCode]))
    : defaultsOnly(rows);

  const rawByKey = new Map<string, Map<string, string>>();
  for (const r of resolved) {
    const erpCode = (r.erpCode ?? "").trim();
    if (!erpCode) continue;
    if (!rawByKey.has(r.brandCode)) rawByKey.set(r.brandCode, new Map());
    rawByKey.get(r.brandCode)!.set(r.departmentCode, r.erpCode as string);
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

/**
 * Load HR dept → Fixed G/L override maps keyed by target (interface) brand.
 *
 * Same rule and same ordering trap as `loadDepartmentErpMapsByTarget`: the
 * `FixedGlAccountNo` filter runs after the pick, so a form's own row that
 * carries no fixed G/L overrides the default *away* rather than falling through
 * to it. Whether a claim posts to the department's G/L account or the default
 * one turns on exactly that.
 *
 * Its only caller today is `erp-journal-context.ts`, which has no form code to
 * give and therefore reads the defaults — identical to its previous behaviour,
 * because before this the read had no `FormCode` predicate at all and every row
 * is still a default. Threading a form code into the Business Central send is a
 * separate piece of work; the parameter is here so that work is a call-site
 * change rather than another rewrite of this function.
 */
export async function loadDeptGlOverridesByTarget(
  interfaceByClaim: Map<string, string>,
  formCode?: string,
): Promise<Map<string, Map<string, DeptGlOverride>>> {
  const pool = await getCorePool();
  const req = pool.request();
  let formWhere = "WHERE FormCode IS NULL";
  if (formCode) {
    req.input("formCode", sql.NVarChar(20), formCode);
    formWhere = `WHERE ${perFormPredicate()}`;
  }
  const res = await req.query(`
    SELECT BrandCode, DepartmentCode, FixedGlAccountNo, FixedGlDescription, FormCode
    FROM [dbo].[DepartmentErpMap]
    ${formWhere}
    ORDER BY BrandCode, DepartmentCode, ${perFormOrderBy()}
  `);

  const rows = (
    res.recordset as {
      BrandCode: string;
      DepartmentCode: string;
      FixedGlAccountNo: string | null;
      FixedGlDescription: string | null;
      FormCode: string | null;
    }[]
  ).map((r) => ({
    brandCode: r.BrandCode.toUpperCase(),
    departmentCode: r.DepartmentCode.trim(),
    fixedGlAccountNo: r.FixedGlAccountNo,
    fixedGlDescription: r.FixedGlDescription,
    // Never `undefined` — see the note in `loadMappings`.
    formCode: r.FormCode ?? null,
  }));

  const resolved = formCode
    ? pickAllForForm(rows, formCode, (row) => JSON.stringify([row.brandCode, row.departmentCode]))
    : defaultsOnly(rows);

  const rawByKey = new Map<string, Map<string, DeptGlOverride>>();
  for (const r of resolved) {
    const accountNo = (r.fixedGlAccountNo ?? "").trim();
    if (!accountNo) continue;
    if (!rawByKey.has(r.brandCode)) rawByKey.set(r.brandCode, new Map());
    rawByKey.get(r.brandCode)!.set(r.departmentCode, {
      accountNo,
      description: (r.fixedGlDescription ?? "").trim(),
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

/**
 * @deprecated use loadDepartmentErpMapsByTarget
 *
 * Zero callers as of 2026-08-20, and kept only because it is exported. It is
 * bounded to the defaults rather than left unfiltered: an unbounded read of
 * this table now returns the default *and* every form's override for the same
 * department, and this function's `Map.set` would silently let whichever the
 * driver returned last decide the ERP dimension. Defaults-only is the honest
 * answer for a function with no way to say which form is asking.
 */
export async function loadAllDepartmentErpMaps(): Promise<Map<string, Map<string, string>>> {
  const pool = await getCorePool();
  const res = await pool.request().query(`
    SELECT BrandCode, DepartmentCode, ErpCode
    FROM [dbo].[DepartmentErpMap]
    WHERE ErpCode IS NOT NULL AND LTRIM(RTRIM(ErpCode)) <> ''
      AND FormCode IS NULL
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
