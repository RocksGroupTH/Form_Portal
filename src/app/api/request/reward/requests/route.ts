import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { statusForAccError } from "@/lib/acc/request-errors";
import { listMyRewardRequests, saveRewardDraft } from "@/lib/acc/reward/request-service";

/* ── GET /api/request/reward/requests — what I have submitted ── */

export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data = await listMyRewardRequests(Number(session.user.id));
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/* ── POST /api/request/reward/requests — create a draft ── */

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });

    const id = await saveRewardDraft(
      {
        brandCode: String(body.brandCode ?? ""),
        rewardId: body.rewardId == null ? null : Number(body.rewardId),
        qty: Number(body.qty ?? 0),
        note: body.note ?? null,
        requesterStaffId: body.requesterStaffId == null ? null : Number(body.requesterStaffId),
      },
      Number(session.user.id),
      loginEmail,
    );
    return NextResponse.json({ ok: true, data: { id } });
  } catch (err) {
    console.error("[api/request/reward/requests] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}
