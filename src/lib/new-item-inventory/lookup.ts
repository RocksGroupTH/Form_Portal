import { resolveBrandErpTarget } from "@/lib/brand-config";
import { getCorePool, sql } from "@/lib/db/mssql";
import { getExternalPool } from "@/lib/db/external-pool";
import type { LookupOption, LookupResource } from "@/features/new-item-inventory/types";

/* ── Registry ── */

interface LookupDef {
  /** Where the data lives: the brand's ERP DB, or our local Fast_Core. */
  source: "erp" | "core";
  /** Table name (unqualified). For "erp" it is prefixed with [DatabaseName].[dbo]. */
  table: string;
  /** Columns to SELECT (raw, trusted — from this file only). */
  columns: string;
  /** Column the ?q= search filters on (LIKE). Omit to disable search. */
  searchColumn?: string;
  /** ORDER BY clause (raw, trusted). */
  orderBy: string;
  /** Map a DB row to a LookupOption. */
  map: (row: Record<string, unknown>) => LookupOption;
}

const str = (v: unknown): string => (v == null ? "" : String(v));

const REGISTRY: Record<LookupResource, LookupDef> = {
  vendors: {
    source: "erp",
    table: "Vendors",
    columns: "[No], [Name], [Name_2], [Location_Code], [Currency_Code], [Blocked]",
    searchColumn: "Name",
    orderBy: "[Name]",
    map: (r) => ({
      value: str(r.No),
      label: `${str(r.No)} - ${str(r.Name)}`,
      meta: {
        name2: str(r.Name_2),
        locationCode: str(r.Location_Code),
        currencyCode: str(r.Currency_Code),
        blocked: str(r.Blocked),
      },
    }),
  },
  "stock-counting": {
    source: "erp",
    table: "PhysInvtCountingPeriodCodeList",
    columns: "[Code], [Description], [Count_Frequency_per_Year]",
    searchColumn: "Description",
    orderBy: "[Code]",
    map: (r) => ({
      value: str(r.Code),
      label: `${str(r.Code)} - ${str(r.Description)}`,
      meta: { countFrequencyPerYear: r.Count_Frequency_per_Year ?? null },
    }),
  },
  uom: {
    source: "erp",
    table: "UnitsOfMeasure",
    columns: "[Code], [Description]",
    searchColumn: "Code",
    orderBy: "[Code]",
    map: (r) => ({ value: str(r.Code), label: `${str(r.Code)} - ${str(r.Description)}` }),
  },
  "no-series": {
    source: "erp",
    table: "NoSeries",
    columns: "[Code], [Description], [LastNoUsed], [Default_Nos]",
    searchColumn: "Code",
    orderBy: "[Code]",
    map: (r) => ({
      value: str(r.Code),
      label: `${str(r.Code)} - ${str(r.Description)}`,
      meta: { lastNoUsed: str(r.LastNoUsed), defaultNos: r.Default_Nos ?? null },
    }),
  },
  "purchasing-code": {
    source: "erp",
    table: "PurchasingCodeList",
    columns: "[Code], [Description]",
    searchColumn: "Code",
    orderBy: "[Code]",
    map: (r) => ({ value: str(r.Code), label: `${str(r.Code)} - ${str(r.Description)}` }),
  },
  "gen-prod-posting-group": {
    source: "erp",
    table: "GenProdPostingGroup",
    columns: "[Code], [Description]",
    searchColumn: "Code",
    orderBy: "[Code]",
    map: (r) => ({ value: str(r.Code), label: `${str(r.Code)} - ${str(r.Description)}` }),
  },
  "vat-prod-posting-group": {
    source: "erp",
    table: "VatProdPostingGroup",
    columns: "[Code], [Description]",
    searchColumn: "Code",
    orderBy: "[Code]",
    map: (r) => ({ value: str(r.Code), label: `${str(r.Code)} - ${str(r.Description)}` }),
  },
  "inventory-posting-group": {
    source: "erp",
    table: "InvenPostingGroup",
    columns: "[Code], [Description]",
    searchColumn: "Code",
    orderBy: "[Code]",
    map: (r) => ({ value: str(r.Code), label: `${str(r.Code)} - ${str(r.Description)}` }),
  },
  "item-categories": {
    source: "erp",
    table: "ItemCategories",
    columns: "[Code], [Description], [Parent_Category], [PRMaintenance], [POSFlag]",
    searchColumn: "Description",
    orderBy: "[Code]",
    map: (r) => ({
      value: str(r.Code),
      label: `${str(r.Code)} - ${str(r.Description)}`,
      meta: {
        parentCategory: str(r.Parent_Category),
        prMaintenance: r.PRMaintenance ?? null,
        posFlag: r.POSFlag ?? null,
      },
    }),
  },
  locations: {
    source: "core",
    table: "NewItemInventoryLocation",
    columns: "[Code], [Name]",
    searchColumn: "Name",
    orderBy: "[Code]",
    map: (r) => ({ value: str(r.Code), label: `${str(r.Code)} - ${str(r.Name)}` }),
  },
};

export function isLookupResource(x: string): x is LookupResource {
  return Object.prototype.hasOwnProperty.call(REGISTRY, x);
}

/* ── Errors ── */

export class LookupError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "LookupError";
  }
}

async function resolveErpTargetForLookup(brandCode: string) {
  try {
    return await resolveBrandErpTarget(brandCode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not configured") || msg.includes("no ERP")) {
      throw new LookupError(
        `Brand "${brandCode}" has no ERP database configured — set it in Settings`,
        409,
        "BRAND_NOT_CONFIGURED",
      );
    }
    throw new LookupError(msg, 500);
  }
}

/* ── In-memory cache (60s) ── */

interface CacheEntry {
  expires: number;
  data: LookupOption[];
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/* ── Main entry point ── */

const SEARCH_LIMIT = 50;

/**
 * Run a lookup for a resource on a brand.
 * @param resource one of the registry keys
 * @param brandCode brand to scope to
 * @param q optional case-insensitive search term
 * @throws LookupError with .status / .code on configuration or connectivity failure
 */
export async function runLookup(
  resource: LookupResource,
  brandCode: string,
  q: string,
): Promise<LookupOption[]> {
  const def = REGISTRY[resource];
  const search = q.trim();
  const cacheKey = `${brandCode}:${resource}:${search.toLowerCase()}`;

  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const where =
    search && def.searchColumn ? `WHERE [${def.searchColumn}] LIKE @q` : "";
  const top = search ? `TOP ${SEARCH_LIMIT} ` : "";

  let recordset: Record<string, unknown>[];

  if (def.source === "core") {
    const pool = await getCorePool();
    const req = pool.request();
    if (search) req.input("q", sql.NVarChar, `%${search}%`);
    // locations are brand-scoped and active-only
    const coreWhere = search
      ? `WHERE BrandCode = @brand AND IsActive = 1 AND [${def.searchColumn}] LIKE @q`
      : `WHERE BrandCode = @brand AND IsActive = 1`;
    req.input("brand", sql.NVarChar, brandCode);
    const result = await req.query(
      `SELECT ${top}${def.columns} FROM [${def.table}] ${coreWhere} ORDER BY ${def.orderBy}`,
    );
    recordset = result.recordset;
  } else {
    const target = await resolveErpTargetForLookup(brandCode);
    const pool = await getExternalPool(target.dbConnectionId).catch(() => {
      throw new LookupError(
        `Cannot reach the ERP database for brand "${brandCode}"`,
        503,
        "ERP_UNREACHABLE",
      );
    });
    const req = pool.request();
    if (search) req.input("q", sql.NVarChar, `%${search}%`);
    try {
      const result = await req.query(
        `SELECT ${top}${def.columns} ` +
          `FROM [${target.databaseName}].[dbo].[${def.table}] ` +
          `${where} ORDER BY ${def.orderBy}`,
      );
      recordset = result.recordset;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ERP query failed";
      throw new LookupError(`ERP lookup failed for "${resource}": ${msg}`, 503, "ERP_QUERY_FAILED");
    }
  }

  const data = recordset.map(def.map);
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, data });
  return data;
}
