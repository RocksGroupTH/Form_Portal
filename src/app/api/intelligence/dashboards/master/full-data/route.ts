import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isValidBrand } from "@/lib/brand";
import {
  getBrandDashboardPool,
  BrandPoolError,
} from "@/lib/intelligence/brand-pool";
import { errorResponse } from "@/lib/intelligence/api-helpers";
import {
  filtersFromRequest,
  buildWhereClause,
  applyInputs,
} from "@/features/intelligence/filters";
import {
  SQL_FULL_DATA,
  FULL_DATA_COLUMNS,
} from "@/features/intelligence/queries";

/** Cap on rows streamed in a single export — defensive. */
const HARD_LIMIT = 200_000;

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const brand = req.nextUrl.searchParams.get("brand");
    if (!brand || !isValidBrand(brand)) {
      return errorResponse(`Invalid brand: ${brand ?? "(missing)"}`, 400);
    }

    // Column whitelist intersect
    const requestedCols = (req.nextUrl.searchParams.get("cols") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const cols =
      requestedCols.length > 0
        ? FULL_DATA_COLUMNS.filter((c) => requestedCols.includes(c))
        : FULL_DATA_COLUMNS;
    if (cols.length === 0) {
      return errorResponse("No valid columns requested", 400);
    }

    const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? HARD_LIMIT);
    const limit = Math.max(1, Math.min(limitParam, HARD_LIMIT));

    let pool;
    try {
      pool = await getBrandDashboardPool(brand);
    } catch (err) {
      if (err instanceof BrandPoolError) {
        const status = err.code === "BRAND_NOT_CONFIGURED" ? 503 : 500;
        return errorResponse(err, status);
      }
      throw err;
    }

    const filters = filtersFromRequest(req.url);
    const { whereSql, inputs } = buildWhereClause(filters);

    const request = applyInputs(pool.request(), inputs);
    request.stream = true;
    request.query(SQL_FULL_DATA(cols, whereSql, limit));

    // Stream a JSON array — `[`, comma-separated row objects, `]`.
    // The client (FullDataTab preview + download) calls `r.json()` /
    // `JSON.parse(text)` on the response, so the body must be valid
    // JSON. Streaming keeps memory bounded for 100k+ row exports
    // instead of buffering the whole result set server-side.
    const encoder = new TextEncoder();
    let first = true;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("["));

        request.on("row", (row: Record<string, unknown>) => {
          // Restrict the emitted object to the whitelisted columns so
          // unexpected resultset columns (e.g. SQL Server adds an
          // internal `__rownum__` if a future SQL change forgets to
          // alias) never leak into the JSON payload.
          const projected: Record<string, unknown> = {};
          for (const c of cols) projected[c] = row[c] ?? null;
          const prefix = first ? "" : ",";
          first = false;
          controller.enqueue(
            encoder.encode(prefix + JSON.stringify(projected))
          );
        });
        request.on("done", () => {
          controller.enqueue(encoder.encode("]"));
          controller.close();
        });
        request.on("error", (err: Error) => controller.error(err));
      },
      cancel() {
        request.cancel();
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/full-data] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
