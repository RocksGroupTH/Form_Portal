import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listAdvanceErpQueue, buildAdvanceErpWorkbook } from "@/lib/adv/advance-queue-service";

/** POST — Excel export of AP-2 ERP-interface rows. Body { ids? } narrows to the
 *  rows the client currently shows; without ids, exports all sent/pending/failed. */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: number[] };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => Number.isFinite(x)) : [];
    const all = await listAdvanceErpQueue();
    const idSet = new Set(ids);
    const rows = ids.length > 0
      ? all.filter((r) => idSet.has(r.id))
      : all.filter((r) => r.erpInterfaceStatus === "Sent" || r.erpInterfaceStatus === "Pending" || r.erpInterfaceStatus === "Failed");

    const buf = buildAdvanceErpWorkbook(rows);
    const filename = `advance-erp-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[api/request/advance/erp-queue/export] POST", err);
    return NextResponse.json({ ok: false, error: "export ไม่สำเร็จ" }, { status: 500 });
  }
}
