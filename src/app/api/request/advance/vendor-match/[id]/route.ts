import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { matchAdvanceVendor } from "@/lib/adv/vendor-match-service";

/** POST /api/request/advance/vendor-match/[id] — run vendor matching for one
 *  advance if still pending; returns the current match state. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const [h, o, d] = await Promise.all([
      isAdvanceApprover(actor.email, "HEAD_ACC"),
      isAdvanceApprover(actor.email, "ACC_OFFICER"),
      isAdvanceApprover(actor.email, "DIRECTOR"),
    ]);
    if (!h && !o && !d) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "id ไม่ถูกต้อง" }, { status: 400 });

  try {
    const result = await matchAdvanceVendor(id);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/request/advance/vendor-match] POST", err);
    return NextResponse.json({ ok: false, error: "จับคู่ Vendor ไม่สำเร็จ" }, { status: 500 });
  }
}
