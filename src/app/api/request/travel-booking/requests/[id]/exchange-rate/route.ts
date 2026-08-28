import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { buildAccActor } from "@/lib/acc/actor-context";
import { applyRateOverride } from "@/lib/acc/rate-override";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/**
 * POST /api/request/travel-booking/requests/[id]/exchange-rate
 * Body: `{ rate: number | string }`
 *
 * Accounting corrects the rate on a foreign AP-17 request, while it is sitting
 * at the ACCOUNT step. Every rate this application records is an ECB
 * mid-market reference rate — no Bank of Thailand key will be provisioned — and
 * this is the only place the difference from what a bank settles at can be
 * corrected.
 *
 * **`AccRequest.TotalAmount` is not rewritten here, and that needs no branch.**
 * For AP-17 that column is the per-diem total alone, always baht, and the
 * request carries no `ForeignAmount`; `planRateOverride` therefore plans no
 * total, for every form, from the row's own data. The booking figures on
 * `AccTravelBookingDetail` stay in the request's own currency exactly as they
 * were entered — what changes is the rate every screen converts them at.
 *
 * Gated the way this form's other ACCOUNT-step routes are — auth, the UAT
 * tester barrier, then `AccBookingApprover` membership or admin — so nothing
 * `account-approve` enforces is loosened to make this reachable. The step
 * itself is the UPDATE's own predicate inside `applyRateOverride`.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/travel-booking` prefix
 * already classifies `AP-17`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // A UAT record is invisible outside the tester group — the id selected the
  // database, membership decides who may touch what it found.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  if (!(await canAccessBookingArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงคำขอนี้" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { rate?: unknown };
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const data = await applyRateOverride(id, AP17_FORM_CODE, actor, body.rate);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "แก้อัตราแลกเปลี่ยนไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
