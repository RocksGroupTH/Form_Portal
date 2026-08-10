import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import { VIEW_CLEAN } from "@/features/intelligence/queries";

export interface BranchEntry {
  id: string;
  name: string;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/branch-map");
    if (ctx instanceof Response) return ctx;

    const data = await withCache<BranchEntry[]>(ctx, async ({ pool }) => {
      const result = await pool.request().query(`
        SELECT DISTINCT
          branch_id  AS id,
          branch_name AS name
        FROM ${VIEW_CLEAN}
        WHERE branch_id IS NOT NULL
          AND branch_name IS NOT NULL
        ORDER BY name ASC
      `);
      return result.recordset.map((r: Record<string, unknown>) => ({
        id: String(r.id ?? ""),
        name: String(r.name ?? ""),
      }));
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/branch-map] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
