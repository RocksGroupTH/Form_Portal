import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import { loadRoomShare } from "@/lib/acc/travel-booking/room-share-service";

/**
 * AP-17 package E — **reading** a guest's own room-share binding.
 *
 * `GET` the share this request is a guest of, or null.
 *
 * ## There is no POST or DELETE here any more
 *
 * They existed until 2026-09-22, and they are the reason the picker demanded a
 * saved draft: attaching was an immediate write to `/room-share/{id}`, and an
 * unsaved tab has no `AccRequest.Id` to write to. Picking a host is now
 * **tab state**, exactly like the ที่พักค้างคืน it replaces, and the binding
 * is written by `saveTravelBookingDraft` → `applyRoomShareSelection`, inside
 * the same transaction as the rest of the tab. Clearing the choice clears the
 * row on the same save.
 *
 * **The write did not lose its gate, it moved to the save's own route**, which
 * is `authorizeAccRequest(…, "mutate", AP17_FORM_CODE)` on the group's anchor
 * and then re-asserts creator-and-`Draft`/`Returned` for every tab, and then
 * re-asserts it a third time in-transaction (`requireEditableGuest`, under
 * `UPDLOCK, HOLDLOCK`). Do **not** reintroduce a write here: two paths that
 * both bind two people's documents are two places for the one-hop invariant to
 * be got wrong.
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
 * `authorizeAccRequest(…, "read", AP-17)` — the **existing** rule, not a new
 * one. `"read"` rather than `"mutate"`: a guest whose request has moved past
 * `Draft` can still be shown who they are sharing with.
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
