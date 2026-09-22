import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import {
  attachRoomShare,
  detachRoomShare,
  loadRoomShare,
} from "@/lib/acc/travel-booking/room-share-service";

/**
 * AP-17 package E — a guest's own room-share binding.
 *
 * `GET`    the share this request is a guest of, or null.
 * `POST`   attach it to a colleague's request (`{ hostRequestId }`).
 * `DELETE` undo the attachment.
 *
 * ## The id is in the PATH, and that is not cosmetic
 *
 * `requestIdFromPath` (`src/lib/form-environment/request-id.ts`) reads the
 * first numeric **path segment** and explicitly ignores a number in the query
 * string, so a UAT record (id ≥ 900000) only routes itself to
 * `Rocks_Portal_Form_UAT` while its id is a segment. With
 * `?guestRequestId=900123` instead, a tester with UAT mode switched off would
 * have the request resolved against production, where it does not exist.
 *
 * ## The gate
 *
 * `authorizeAccRequest(…, "mutate", AP-17)` — the **existing** rule, not a new
 * one. It is `decideRequestMutate`: creator only, `Draft`/`Returned` only,
 * plus the UAT tester barrier, which is why these handlers need no separate
 * `uatActorGate` the way AP-17's older by-id routes do. Task 4's brief is that
 * attaching or detaching must require the guest's own request to be editable
 * through the rule this codebase already has, and this is it.
 *
 * The service re-asserts the same rule **inside the transaction that writes**
 * (`requireEditableGuest`), because the verdict here is taken before the
 * transaction opens.
 */

/** A positive safe integer, or null — never `NaN`, never a float, never 0. */
function parseId(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/* ── GET — the current binding ── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ guestRequestId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { guestRequestId: raw } = await params;
  const guestRequestId = parseId(raw);
  if (guestRequestId === null) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // "read", not "mutate": a guest whose request has moved past Draft can still
  // be shown who they are sharing with.
  const gate = await authorizeAccRequest(session, guestRequestId, "read", AP17_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const data = await loadRoomShare(guestRequestId);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/travel-booking/room-share] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/* ── POST — attach to a colleague's request ── */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ guestRequestId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { guestRequestId: raw } = await params;
  const guestRequestId = parseId(raw);
  if (guestRequestId === null) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, guestRequestId, "mutate", AP17_FORM_CODE);
  if (gate instanceof Response) return gate;

  let hostRequestId: number | null = null;
  try {
    const body = (await req.json()) as { hostRequestId?: unknown };
    hostRequestId = parseId(body?.hostRequestId == null ? null : String(body.hostRequestId));
  } catch {
    hostRequestId = null;
  }
  if (hostRequestId === null) {
    return NextResponse.json(
      { ok: false, error: "กรุณาเลือกคำขอที่ต้องการพักห้องร่วมด้วย" },
      { status: 400 },
    );
  }

  try {
    const data = await attachRoomShare({
      guestRequestId,
      hostRequestId,
      userId: Number(session.user.id),
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}

/* ── DELETE — undo the attachment ── */

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ guestRequestId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { guestRequestId: raw } = await params;
  const guestRequestId = parseId(raw);
  if (guestRequestId === null) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, guestRequestId, "mutate", AP17_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const data = await detachRoomShare({ guestRequestId, userId: Number(session.user.id) });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
