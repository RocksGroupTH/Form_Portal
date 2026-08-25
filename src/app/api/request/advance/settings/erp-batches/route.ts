import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listErpBatchesAutoSync,
  listErpBatchStatus,
  syncErpBatches,
  advanceErpEnvironment,
} from "@/lib/adv/advance-batch-service";

/** GET — Journal Batches for a Company in AP-2's environment (?company=), cache-first with auto-fill. */
export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
    const environment = await advanceErpEnvironment();
    if (!company) return NextResponse.json({ ok: true, data: { environment, batches: [], status: [] } });
    const [{ batches, autoSynced, error }, status] = await Promise.all([
      listErpBatchesAutoSync(company, environment),
      listErpBatchStatus(),
    ]);
    return NextResponse.json({ ok: !error, error: error ?? undefined, data: { environment, batches, status, autoSynced } });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-batches] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST — sync a Company's batches from BC (both environments) into the cache. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as { company?: string };
    const company = (body.company ?? "").trim();
    if (!company) return NextResponse.json({ ok: false, error: "กรุณาเลือก Company" }, { status: 400 });
    const data = await syncErpBatches(company);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-batches] POST", err);
    const msg = err instanceof Error ? err.message : "sync ไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
