import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  loadHostByRequestNo,
  loadHostableRequests,
  type HostCandidateRow,
} from "@/lib/acc/travel-booking/room-share-service";

/**
 * AP-17 package E — **browsing the requests that could host a room share.**
 *
 * `GET /api/request/travel-booking/room-share/hosts
 *      ?staffId=123[&travelFrom=&travelTo=][&requestedFrom=&requestedTo=][&excludeRequestId=]`
 * `GET /api/request/travel-booking/room-share/hosts?requestNo=TRL26-00100[&excludeRequestId=]`
 *
 * ## This endpoint is `requireAuth`, and that is a deliberate widening
 *
 * It replaces `…/room-share/{guestRequestId}/hosts`, which took the caller's
 * **own** request id in its path and authorized
 * `authorizeAccRequest(…, "mutate", AP-17)` against it. That gate is gone.
 *
 * It was put there on purpose, and it was argued for twice: without it, any
 * authenticated employee can enumerate colleagues' AP-17 running numbers,
 * travel dates and work locations. **The user asked twice (2026-09-22) for the
 * friction it caused to go** — an unsaved tab has no `AccRequest.Id`, so the
 * gate forced the requester to press บันทึกร่าง before they could so much as
 * look — and this is that decision, not an oversight. It is consistent with
 * this application already letting anyone file a request on behalf of any
 * active employee (CLAUDE.md, AP-4's on-behalf note: *"anyone may file for any
 * active employee"*).
 *
 * **Browsing was separated from attaching; the write kept its gate.** Writing
 * the binding is `applyRoomShareSelection`, reached only through
 * `saveTravelBookingDraft`, which is `authorizeAccRequest(…, "mutate",
 * AP-17)` at its own route, re-asserts creator-and-`Draft`/`Returned` for
 * every tab of the group, and re-asserts it a third time in-transaction under
 * `UPDLOCK, HOLDLOCK`. Binding two people's documents together is the act
 * that needed the gate, and it still has it.
 *
 * ## What still holds this in
 *
 * 1. **It answers three facts and an id, never a record.** `HostCandidateRow`
 *    is the running number, the travel dates and the work location — not the
 *    amount, not the attachments, not the ID card, not the requester's other
 *    fields. The shape is built in `room-share-service.ts` from an explicit
 *    column list and is pinned by `room-share-response-shape-guard.test.ts`.
 *    **Nothing about the shape was widened when the gate came off.**
 * 2. **`decideRequestRead` still governs opening the record itself.** Opening
 *    one of these requests is still `GET /requests/[id]`, unchanged, which
 *    refuses anybody that policy refuses.
 * 3. **Only *hostable* requests are offered** — alive, filed, not already a
 *    guest, `needsRoomBooking = true` — decided by Task 2's `canHost` plus the
 *    service's `hostHasBeenFiled`, not re-expressed here.
 * 4. **One mode or the other, and both are required to name something.**
 *    There is no "list everything": `staffId` names a person, `requestNo`
 *    names one request, and neither parameter has a wildcard.
 *
 * ## `requestNo` IS a by-id read of a request the caller names, and that is new
 *
 * The old route's second holding argument was that it "exposes no by-id read
 * of somebody else's request: the colleague's requests are found by a
 * person-and-date scan". The running-number tab (the user's point 2,
 * 2026-09-22) is exactly such a read, and running numbers are sequential, so
 * it is enumerable in a way the person scan was not. Recorded rather than
 * glossed: it is bounded to *hostable* AP-17 requests and to the same five
 * fields, and it is the feature that was asked for.
 *
 * ## Which database answers
 *
 * There is no id in the path any more, so `requestIdFromPath` finds no numeric
 * segment and the environment resolves from the viewer — their UAT mode and
 * the form's switches — rather than from the guest record. That is the right
 * answer and not a fallback: a tester browsing in UAT mode must be offered UAT
 * hosts, which is exactly the environment their own tab is being written to.
 * **`ROUTE_RULES` needs no new entry**: `classify-path.ts` carries
 * `{ prefix: "/api/request/travel-booking", result: "AP-17" }`, and
 * longest-matching-prefix already covers this path.
 *
 * **The static `hosts` segment beats the sibling `[guestRequestId]` route**,
 * which still serves `GET` for a guest's own binding. Next resolves a literal
 * segment before a dynamic one, and `parseId("hosts")` would answer null and
 * 400 even if it did not.
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

/**
 * The longest running number this will look up.
 *
 * `AccRequest.RequestNo` is `NVARCHAR(50)`; anything longer names nothing and
 * would only be a parameter the driver has to carry. A bound here rather than
 * a truncation, for the reason `sanitizeBookingNo` gives about the opposite
 * case: silently shortening an identifier answers a question nobody asked.
 */
const MAX_REQUEST_NO = 50;

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const sp = req.nextUrl.searchParams;
  // Only ever narrows: it drops the caller's own tab out of the list, or
  // answers the policy's own self-attach sentence for the number tab. Null
  // while the tab has not been saved, which is now an ordinary state.
  const excludeRequestId = parseId(sp.get("excludeRequestId"));

  const rawNo = (sp.get("requestNo") ?? "").trim();
  const byNumber = rawNo.length > 0;

  const staffId = parseId(sp.get("staffId"));
  if (!byNumber && staffId === null) {
    return NextResponse.json(
      { ok: false, error: "กรุณาเลือกเพื่อนร่วมงาน หรือระบุเลขที่คำขอ" },
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
    /* ONE success response, assembled here. Both modes answer the identical
       `{ hosts, notice }`: a second `ok: true` arm — or a spread beside
       `data` — is how a field nobody intended to expose joins the payload
       without touching any column list, which is what
       `room-share-response-shape-guard.test.ts` counts. */
    let data: { hosts: HostCandidateRow[]; notice: string | null };

    if (byNumber) {
      // Over-length is answered as "names nothing" rather than sent on.
      // `RequestNo` is NVARCHAR(50) and the parameter is bound at that width,
      // so the driver would TRUNCATE a longer string — and a truncated string
      // can match a real number that the caller never typed.
      const result =
        rawNo.length > MAX_REQUEST_NO
          ? ({ kind: "not_found" } as const)
          : await loadHostByRequestNo(rawNo, excludeRequestId);
      // Three outcomes, two of them a `notice` rather than an empty list —
      // "no such number" and "that number names a request you may not share"
      // need different next actions from the requester, which is the whole
      // point of the second tab. The refusal text is the POLICY's own
      // sentence, carried verbatim from `canHost` / `HOST_NOT_FILED_MESSAGE` /
      // `SELF_ATTACH_MESSAGE`; only "not found" is this route's own copy,
      // because it is not a policy refusal at all.
      data =
        result.kind === "found"
          ? { hosts: [result.host], notice: null }
          : result.kind === "not_found"
            ? { hosts: [], notice: `ไม่พบคำขอเลขที่ ${rawNo}` }
            : { hosts: [], notice: result.message };
    } else {
      const hosts = await loadHostableRequests({
        staffId: staffId as number,
        excludeRequestId,
        travelFrom: travelFrom.value,
        travelTo: travelTo.value,
        requestedFrom: requestedFrom.value,
        requestedTo: requestedTo.value,
      });
      data = { hosts, notice: null };
    }

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/travel-booking/room-share/hosts] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
