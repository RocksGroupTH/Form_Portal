import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
import {
  deleteRewardDraft,
  getRewardRequest,
  saveRewardDraft,
} from "@/lib/acc/reward/request-service";
import { AP11_FORM_CODE } from "@/features/reward/constants";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ── GET /api/request/reward/requests/[id] ── */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  // `requireAuth()` proves a session, not a right to this record. The FormCode
  // argument also stops an AP-1 or AP-17 id being read through an AP-11 route.
  const gate = await authorizeAccRequest(session, id, "read", AP11_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const data = await getRewardRequest(id);
    if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/* ── PUT /api/request/reward/requests/[id] — save the draft ── */

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const gate = await authorizeAccRequest(session, id, "mutate", AP11_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const body = await req.json();
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });

    await saveRewardDraft(
      {
        id,
        brandCode: String(body.brandCode ?? ""),
        rewardId: body.rewardId == null ? null : Number(body.rewardId),
        qty: Number(body.qty ?? 0),
        note: body.note ?? null,
        requesterStaffId: body.requesterStaffId == null ? null : Number(body.requesterStaffId),
      },
      Number(session.user.id),
      loginEmail,
    );

    const data = await getRewardRequest(id);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]] PUT", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}

/* ── DELETE /api/request/reward/requests/[id] — discard a draft ── */

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const gate = await authorizeAccRequest(session, id, "mutate", AP11_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    await deleteRewardDraft(id, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]] DELETE", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}
