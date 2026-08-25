import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { previewClrErpJournal } from "@/lib/clr/clear-advance-erp-send";

export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return NextResponse.json({ ok: true, data: [] });
  try {
    return NextResponse.json({ ok: true, data: await previewClrErpJournal(ids) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
