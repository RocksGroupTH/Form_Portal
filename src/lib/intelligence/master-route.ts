import type { NextRequest } from "next/server";
import type sql from "mssql";
import { requireAuth } from "@/lib/api-auth";
import { isValidBrand } from "@/lib/brand";
import {
  getBrandDashboardPool,
  BrandPoolError,
} from "@/lib/intelligence/brand-pool";
import {
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/api-helpers";
import {
  getCached,
  putCached,
  makeCacheKey,
} from "@/lib/intelligence/api-cache";
import {
  filtersFromRequest,
  buildWhereClause,
  applyInputs,
  type Filters,
  type SqlInput,
} from "@/features/intelligence/filters";

/** TTL applied to every Master Dashboard cache entry. Mirrors the Dashboard project. */
export const MASTER_CACHE_TTL_MS = 90_000;

export interface MasterRouteContext {
  brand: string;
  pool: sql.ConnectionPool;
  filters: Filters;
  whereSql: string;
  inputs: SqlInput[];
  /** Cache key already includes brand + sorted searchParams. */
  cacheKey: string;
}

/**
 * Build a Master Dashboard route context: auth + brand validation + cache key + pool.
 * Returns a `Response` if auth or brand validation fails — caller should early-return.
 * Returns a `MasterRouteContext` on success.
 */
export async function buildMasterContext(
  req: NextRequest,
  route: string,
): Promise<Response | MasterRouteContext> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = req.nextUrl.searchParams.get("brand");
  if (!brand || !isValidBrand(brand)) {
    return errorResponse(`Invalid brand: ${brand ?? "(missing)"}`, 400);
  }

  const cacheKey = makeCacheKey(`${route}:${brand}`, req.nextUrl.searchParams);
  const filters = filtersFromRequest(req.url);
  const { whereSql, inputs } = buildWhereClause(filters);

  let pool: sql.ConnectionPool;
  try {
    pool = await getBrandDashboardPool(brand);
  } catch (err) {
    if (err instanceof BrandPoolError) {
      const status = err.code === "BRAND_NOT_CONFIGURED" ? 503 : 500;
      return errorResponse(err, status);
    }
    throw err;
  }

  return { brand, pool, filters, whereSql, inputs, cacheKey };
}

/**
 * Standard cache+query flow: check cache, run loader on miss, persist, return.
 * Loader receives the route context and returns the JSON payload's `data` field.
 */
export async function withCache<T>(
  ctx: MasterRouteContext,
  loader: (ctx: MasterRouteContext) => Promise<T>,
): Promise<T> {
  const hit = getCached<T>(ctx.cacheKey, MASTER_CACHE_TTL_MS);
  if (hit !== null) return hit;
  const fresh = await loader(ctx);
  putCached(ctx.cacheKey, fresh);
  return fresh;
}

/** Re-export for handler convenience (so handlers only import master-route). */
export { applyInputs, jsonResponse, errorResponse };
