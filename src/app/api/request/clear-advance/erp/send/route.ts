import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { sendClrErpBatch } from "@/lib/clr/clear-advance-erp-send";

export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { ids?: number[] };
    const ids = (body.ids ?? []).filter((n) => Number.isFinite(n));
    if (ids.length === 0)
      return NextResponse.json({ ok: false, error: "ไม่มีรายการ" }, { status: 400 });
    const results = await sendClrErpBatch(ids, Number(session.user.id));
    return NextResponse.json({ ok: true, data: results });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
