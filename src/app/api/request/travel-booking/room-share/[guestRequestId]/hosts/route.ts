import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import { loadHostableRequests } from "@/lib/acc/travel-booking/room-share-service";

/**
 * AP-17 package E — **one person listing another person's requests.**
 *
 * `GET /api/request/travel-booking/room-share/{guestRequestId}/hosts
 *      ?staffId=123[&travelFrom=&travelTo=][&requestedFrom=&requestedTo=]`
 *
 * This is new reach in this application, and spec §6 is deliberately narrow
 * about it. Five things hold it in:
 *
 * 1. **It answers three facts and an id, never a record.** `HostCandidateRow`
 *    is the running number, the travel dates and the work location — not the
 *    amount, not the attachments, not the ID card, not the requester's other
 *    fields. The shape is built in `room-share-service.ts` from an explicit
 *    column list and is pinned by `room-share-response-shape-guard.test.ts`.
 * 2. **`decideRequestRead` still governs opening the record itself, and this
 *    endpoint is not a way around it.** It exposes no by-id read of somebody
 *    else's request: the only id a caller supplies is *their own*
 *    (`guestRequestId`, in the path), and the colleague's requests are found by
 *    a person-and-date scan rather than by an id the caller names. Opening one
 *    of them is still `GET /requests/[id]`, unchanged, which refuses anybody
 *    `decideRequestRead` refuses.
 * 3. **The caller must already hold an editable AP-17 request of their own.**
 *    `authorizeAccRequest(…, "mutate", AP-17)` on `guestRequestId` — creator
 *    only, `Draft`/`Returned` only, plus the UAT tester barrier. So the reach
 *    is granted to somebody who could legitimately attach, not to every
 *    authenticated session. This mirrors what AP-17's form already demands
 *    before its ID-card upload ("กรุณาบันทึกร่างก่อนแนบไฟล์"), so the picker
 *    costs the requester nothing new.
 * 4. **`staffId` is required.** There is no "list everything" mode; a caller
 *    must already know which colleague they mean, which is what the person
 *    picker in front of this answers.
 * 5. **Only *hostable* requests are offered** — alive, not already a guest,
 *    `needsRoomBooking = true` — decided by Task 2's `canHost`, not
 *    re-expressed here.
 *
 * **`ROUTE_RULES` needs no new entry.** Verified rather than assumed:
 * `classify-path.ts` carries `{ prefix: "/api/request/travel-booking", result:
 * "AP-17" }`, and longest-matching-prefix means this path is already AP-17. The
 * `{guestRequestId}` segment is also what lets `requestIdFromPath` route a UAT
 * record to `Rocks_Portal_Form_UAT` — it reads path segments and deliberately
 * ignores query-string numbers.
 *
 * **The person search is NOT here.** Spec §6 reuses the existing directory
 * search rather than adding a second one; see the report accompanying this
 * task for which of the two existing searches an ordinary requester can
 * actually call.
 */

/** A positive safe integer, or null. */
function parseId(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` filter, **refused rather than coerced**.
 *
 * `new Date("2026-8-31")` parses happily, and a filter that silently answers a
 * question about one day with another day's rows is the class of failure
 * `fx-cache-policy.ts` already documents. An absent parameter is not an error;
 * a malformed one is.
 */
function parseYmd(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (!YMD.test(raw)) return { ok: false };
  return { ok: true, value: raw };
}

export async function GET(
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

  // Point 3 above — and it runs before a single colleague's row is read.
  const gate = await authorizeAccRequest(session, guestRequestId, "mutate", AP17_FORM_CODE);
  if (gate instanceof Response) return gate;

  const sp = req.nextUrl.searchParams;
  const staffId = parseId(sp.get("staffId"));
  if (staffId === null) {
    return NextResponse.json(
      { ok: false, error: "กรุณาเลือกเพื่อนร่วมงานก่อน" },
      { status: 400 },
    );
  }

  const travelFrom = parseYmd(sp.get("travelFrom"));
  const travelTo = parseYmd(sp.get("travelTo"));
  const requestedFrom = parseYmd(sp.get("requestedFrom"));
  const requestedTo = parseYmd(sp.get("requestedTo"));
  if (!travelFrom.ok || !travelTo.ok || !requestedFrom.ok || !requestedTo.ok) {
    return NextResponse.json(
      { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  try {
    const data = await loadHostableRequests({
      staffId,
      // The guest's own request is never its own host. `canAttach` refuses it
      // anyway (`self_attach`); dropping it here keeps it off the list rather
      // than offering a choice that is then refused.
      excludeRequestId: guestRequestId,
      travelFrom: travelFrom.value,
      travelTo: travelTo.value,
      requestedFrom: requestedFrom.value,
      requestedTo: requestedTo.value,
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/travel-booking/room-share/hosts] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
