import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { setBrandActiveShared } from "@/lib/adv/brand-active-service";

/** POST { brandCode, active } — turn a brand on/off for AP-2 + AP-3 (shared). */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as { brandCode?: string; active?: boolean };
    const brandCode = (body.brandCode ?? "").trim();
    if (!brandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์" }, { status: 400 });
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ ok: false, error: "active ต้องเป็น true/false" }, { status: 400 });
    }
    await setBrandActiveShared(brandCode, body.active, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/brand-active] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
