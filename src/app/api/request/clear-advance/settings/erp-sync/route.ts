import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { syncErpForGlSettings, type GlSyncTarget } from "@/lib/clr/gl-settings-sync";

/**
 * POST /api/request/clear-advance/settings/erp-sync
 * body: { company, target: "glAccounts" | "buGlMap" }
 *
 * Pull from Business Central what the calling settings screen lists, for one
 * company — see `syncErpForGlSettings` for which phases each target runs.
 *
 * **Admin only, whatever settings tabs the caller holds.** It writes
 * `ErpAccounts`, `ErpDimensionValue`, `ErpLocation` and `ErpSyncLog` in
 * `Rocks_ERP_Data`, and those are not this app's private rows: Rocks Fast
 * writes the neighbouring tables and ACC Portal reads them through `Fast_Data`'s
 * synonyms. The same rule AP-1's `erp-accounts/sync` and AP-3's
 * `locations/sync` already carry — a tab grant must never become write access
 * to rows two other applications depend on.
 *
 * **200 with the errors listed, not 400, when only some phases failed.** A
 * company whose Locations have never been configured still gets its chart of
 * accounts, and the screen says which half did not arrive; answering 400 would
 * throw away the half that worked.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      company?: string;
      target?: string;
    };
    const target: GlSyncTarget = body.target === "buGlMap" ? "buGlMap" : "glAccounts";
    const data = await syncErpForGlSettings(
      body.company ?? "",
      target,
      Number(session.user.id),
    );
    // Nothing at all came back: there is no half to keep, so this is a failure.
    if (data.phases.length === 0 && data.errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: data.errors.map((e) => `${e.label}: ${e.error}`).join(" · "), data },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("[api/request/clear-advance/settings/erp-sync] POST", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Sync failed" },
      { status: 400 },
    );
  }
}
