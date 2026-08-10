import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import {
  SQL_DISTINCTS,
  SQL_DISTINCT_YM,
  SQL_DISTINCT_DAYS,
  ALLOWED_DISTINCT_COLUMNS,
} from "@/features/intelligence/queries";
import sql from "mssql";

const DEFAULT_WINDOW_MONTHS = 6;

function defaultDistinctStart(): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (DEFAULT_WINDOW_MONTHS - 1),
      1
    )
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/distincts");
    if (ctx instanceof Response) return ctx;

    const col = req.nextUrl.searchParams.get("col");
    if (!col) {
      return errorResponse("Missing required 'col' parameter", 400);
    }

    let query: string;
    if (col === "ym") {
      query = SQL_DISTINCT_YM;
    } else if (col === "day") {
      query = SQL_DISTINCT_DAYS;
    } else if (col in ALLOWED_DISTINCT_COLUMNS) {
      query = SQL_DISTINCTS(ALLOWED_DISTINCT_COLUMNS[col]);
    } else {
      return errorResponse(`Column '${col}' is not whitelisted`, 400);
    }

    const data = await withCache<string[]>(ctx, async ({ pool }) => {
      const request = pool
        .request()
        .input("distinct_start", sql.Date, defaultDistinctStart());
      const result = await request.query(query);
      return result.recordset.map((r: Record<string, unknown>) => String(r.v ?? ""));
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/distincts] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
