import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { getRequest } from "@/lib/adv/advance-request-service";
import { confirmAdvanceVendor } from "@/lib/adv/vendor-match-service";

/** POST { id, vendorNo } — confirm/override the vendor at the ACC_OFFICER step. */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const ok = await isAdvanceApprover(actor.email, "ACC_OFFICER");
    if (!ok) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number; vendorNo?: string };
  const id = Number(body.id);
  const vendorNo = typeof body.vendorNo === "string" ? body.vendorNo.trim() : "";
  if (!Number.isFinite(id) || !vendorNo) {
    return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const reqRow = await getRequest(id);
  if (!reqRow?.brandCode) return NextResponse.json({ ok: false, error: "ไม่พบคำขอ" }, { status: 404 });

  try {
    await confirmAdvanceVendor(id, reqRow.brandCode, vendorNo, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ยืนยัน Vendor ไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
