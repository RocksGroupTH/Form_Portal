/**
 * Room-share storage — the pool half of AP-17 package E.
 *
 * `room-share-policy.ts` decides who may host and who may attach;
 * `room-share-cascade.ts` decides what happens to a host's guests. Neither
 * touches a database. **This module is the one that does**, and it owns four
 * jobs:
 *
 * - `loadHostableRequests` — the picker's list of one colleague's requests
 *   that can host (spec §6);
 * - `loadHostByRequestNo` — the same admission decision for **one** request
 *   named by its running number (the picker's second tab, 2026-09-22);
 * - `loadRoomShare` / `applyRoomShareSelection` — the guest's own binding;
 * - `loadGuestsOf` — every guest of one host, for the cascade (spec §4).
 *
 * ## The binding is written by the TAB SAVE, not by an endpoint of its own
 *
 * Until 2026-09-22 this module exported `attachRoomShare` and
 * `detachRoomShare`, each opening its own transaction behind a `POST`/`DELETE`
 * on `/room-share/{guestRequestId}`. Both are gone. Picking a host is now
 * ordinary tab state — like the accommodation it replaces — and
 * `saveTravelBookingDraft` calls `applyRoomShareSelection` **inside the
 * transaction that writes the rest of the tab**, so the binding, the
 * withdrawal of the guest's own room and the trip's dates commit or roll back
 * together.
 *
 * **Nothing about the write's authorization was relaxed by that move.** The
 * save path is `authorizeAccRequest(…, "mutate", AP-17)` at its route and
 * re-asserts creator-and-`Draft`/`Returned` for every tab in the group before
 * it writes; `applyRoomShareSelection` re-asserts it a third time through
 * `requireEditableGuest`, under the same `UPDLOCK, HOLDLOCK` the old attach
 * took. What DID change is **browsing** — see `loadHostableRequests` and the
 * `room-share/hosts` route.
 *
 * ## `@/env` is why there is no unit test beside this file
 *
 * Everything here reaches `getAccPool()` → `@/lib/db/mssql` → `@/env`, which
 * validates the whole environment at import time and throws in a test run. The
 * admission logic that could be tested is deliberately not here — it is Task
 * 2's pure `canHost`/`canAttach`, already covered by
 * `room-share-policy.test.ts`. What this file adds on top of that is tested by
 * `room-share-response-shape-guard.test.ts`, which reads this source: the
 * failure it exists to catch is a *column* reaching the picker's response, and
 * no behavioural test of a function that cannot be imported would see it.
 *
 * ## The one condition this module adds on top of `canHost`
 *
 * `hostHasBeenFiled`. See its own docblock — it is written once and applied at
 * all three sites (the listing, the by-number lookup, and the save's own
 * re-check), because a list and an action that disagree about what is
 * offerable is exactly the shape of bug this feature cannot afford.
 */

import { getAccPool, sql } from "@/lib/acc/pool";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import { AccConflictError, AccForbiddenError } from "@/lib/acc/request-errors";
import { ACL_NOT_EDITABLE, EDITABLE_STATUSES } from "@/lib/acc/request-acl-policy";
import {
  canAttach,
  canHost,
  SELF_ATTACH_MESSAGE,
  type ShareCandidate,
  type ShareRefusal,
} from "@/lib/acc/travel-booking/room-share-policy";
import type { GuestState } from "@/lib/acc/travel-booking/room-share-cascade";
import { clearGuestOwnAccommodation } from "@/lib/acc/travel-booking/room-share-guest-room";
import { queueRoomShareAttachedMail } from "@/lib/acc/travel-booking/room-share-notify";

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/**
 * Anything with `.request()` — a pool, or a caller's open transaction.
 *
 * The same structural type `perdiem-dependency-load.ts` and
 * `requester-trips.ts` already use, copied rather than invented: `mssql`'s
 * `ConnectionPool` and `Transaction` both expose `.request()` with the same
 * signature, so this admits either without importing either class by name.
 * **`loadGuestsOf` needs it** — the cascade (Task 6) calls that loader from
 * inside the transaction that is already cancelling or re-dating the host, and
 * a loader that could only take a pool would read the pre-transaction state of
 * the very rows its caller is changing.
 */
type SqlRunner = { request: () => ReturnType<AccPool["request"]> };

/**
 * The copy `decideRequestMutate` already answers a non-editable request with.
 *
 * `ACL_NOT_EDITABLE` is typed as the whole `AclVerdict` union, so the message
 * has to be narrowed out rather than read straight off the constant. Worth the
 * awkwardness: a second spelling of one refusal is a second thing to keep in
 * step with the rule it describes.
 */
const NOT_EDITABLE_MESSAGE = ACL_NOT_EDITABLE.ok ? "" : ACL_NOT_EDITABLE.error;

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ─────────────────────────── the response shape ─────────────────────────── */

/**
 * One row of the host picker — **and the only shape this module ever returns
 * about somebody else's request.**
 *
 * ## It carries nine fields since 2026-09-23, and it used to carry five
 *
 * Spec §6 named three facts — the running number, the travel dates and the
 * work location — plus `requestId`, which is not a fourth fact but the handle
 * the picker records in the tab and the save posts back. Every brief on this
 * feature until 2026-09-23 said "five fields and do not add a sixth without
 * asking". **That is the asking, and the user's answer was yes.** Two of
 * their requests need more:
 *
 * - **the host's identity** (`staffId`) — a host picked by running number
 *   rendered as "เพื่อนร่วมงาน" beside a blank avatar, because the picker had
 *   no person to name. Only the id is carried: the name and the photograph
 *   are then read by the browser from
 *   `/api/request/travel-booking/requesters?staffId=`, the `requireAuth`
 *   roster search this picker already calls, so no name or photograph is new
 *   reach — the **link** is;
 * - **the rest of the trip** (`brandCode`, `reasonId`, `reasonCustomText`,
 *   `workDetail`, and the work locations that were already here) — two people
 *   sharing a room are on the same trip, and `room-share-prefill.ts` fills
 *   the guest's tab in from these where the guest has not filled it
 *   themselves.
 *
 * **What that costs, in plain terms, because the residual belongs where it is
 * read:** any authenticated employee can now read *who went where, when, why,
 * and what the work was* for any AP-17 request, by walking sequential running
 * numbers. The route's own docblock states the same thing at the endpoint.
 *
 * **What is still excluded, on its own merits and not by inertia: not the
 * amount, not the attachments, not the ID card, not the per-diem figures**,
 * and not the work locations' coordinates — `workLocations` stays a list of
 * bare names. Listing another person's requests is reach this application did
 * not have before package E, so the shape is built from an explicit column
 * list (`HOST_DISPLAY_COLUMNS`) rather than from a `SELECT *` or a reuse of
 * `getTravelBookingRequest`'s read shape — the latter being how a field nobody
 * intended to expose arrives by inheritance. `room-share-response-shape-guard.test.ts`
 * asserts both halves: these keys, and those columns.
 */
export interface HostCandidateRow {
  requestId: number;
  requestNo: string | null;
  departDate: string | null;
  returnDate: string | null;
  /**
   * `AccTravelWorkLocation` — the name **and its pin**, for each place.
   *
   * **It was `string[]` until 2026-09-23, and the coordinates were argued
   * *out* twice before being argued back in by a measurement.** The picker
   * does not draw a map, so the pin looked like reach nobody needed. It is
   * not: since 2026-09-01 `validateTravelBookingTab` refuses a submit whose
   * work location is not pinned — `workLocationIssue(…) === "unpinned"`,
   * "สถานที่ไปปฏิบัติงานต้องเลือกจากผลค้นหา Google Maps" — so a name copied
   * into the guest's tab without its pin produces a field that **looks filled
   * in and cannot be submitted**, refused over a value the system put there
   * itself. The requester's remedy would be to delete it and re-pick the same
   * place, which is the work the prefill exists to save. Names alone would
   * have been the worse answer, not the safer one.
   *
   * `room-share-prefill.ts` copies a row only when it is named **and**
   * pinned, asking `hasUsablePin` — the same predicate the two validators
   * ask, rather than a third spelling of it.
   */
  workLocations: { name: string; lat: number | null; lng: number | null }[];
  /**
   * `AccRequest.StaffId` — the host's HR id, and **only** the id.
   *
   * It is the link the card resolves a name and a photograph from, through
   * the roster search the picker already uses. Null for a request written
   * with no StaffId, which `loadHostableRequests` cannot offer by person
   * anyway and which the card then falls back to the running number for.
   */
  staffId: number | null;
  /** `AccRequest.BrandCode` — แบรนด์ที่เบิก, for the prefill. */
  brandCode: string | null;
  /** `AccTravelBooking.ReasonId` — เหตุผลการเดินทาง, for the prefill. */
  reasonId: number | null;
  /** `AccTravelBooking.ReasonCustomText` — ระบุเหตุผลเพิ่มเติม, for the prefill. */
  reasonCustomText: string | null;
  /** `AccTravelBooking.WorkDetail` — รายละเอียดการไปปฏิบัติงาน, for the prefill. */
  workDetail: string | null;
}

/** A guest's own binding, as the form renders it. */
export interface RoomShareView {
  guestRequestId: number;
  /** Denormalised for display only — the host's identity is `host.requestId`. See migration 156. */
  hostStaffId: number | null;
  host: HostCandidateRow;
}

/**
 * **The only column list that reaches `HostCandidateRow`.**
 *
 * One entry per emitted field and nothing else. Admission inputs
 * (`Status`, `NeedsRoomBooking`, the share rows) are read by a *different*
 * query — `CANDIDATE_COLUMNS` below — which is not a stylistic split: it means
 * the display columns are read only for requests that have already passed
 * `canHost`, so a request the caller may not be offered never has its dates,
 * its reason or its work detail fetched at all. That split mattered more once
 * the list widened on 2026-09-23 than it did when it was written.
 */
/* Deliberately ONE double-quoted string on one line, however long it grows:
   `room-share-response-shape-guard.test.ts`'s `columnsOf` reads it with a
   regex over exactly that shape and says so ("no longer a plain double-quoted
   string"). A concatenation here would hand the guard the first fragment and
   leave every column after the `+` unchecked. */
const HOST_DISPLAY_COLUMNS = "r.Id, r.RequestNo, r.StaffId, r.BrandCode, t.DepartDate, t.ReturnDate, t.ReasonId, t.ReasonCustomText, t.WorkDetail";

/**
 * The second and last list feeding the response: a work location's name **and
 * its pin**, plus the request it hangs off.
 *
 * `w.Lat, w.Lng` (migration 135) joined it on 2026-09-23, and the reason is
 * `HostCandidateRow.workLocations`' own docblock: a copied place that is not
 * pinned cannot be submitted, so a name without its coordinates is not a
 * narrower answer to the user's point 3, it is an unusable one.
 */
const HOST_LOCATION_COLUMNS = "t.RequestId, w.Name, w.Lat, w.Lng";

/**
 * What `canHost` needs to judge a candidate, and nothing that is emitted for
 * its own sake. `RequestNo` is here because every refusal message names it
 * (`room-share-policy.ts`'s `requestLabel`), not because the picker shows it —
 * it appears in `HOST_DISPLAY_COLUMNS` for that.
 */
const CANDIDATE_COLUMNS = "r.Id, r.RequestNo, r.Status, t.NeedsRoomBooking";

/**
 * How many of a colleague's requests the scan considers before `canHost` runs.
 *
 * A fixed constant, never client-supplied. The cap sits on the *scan*, so in
 * principle a person with more than this many AP-17 requests could have a
 * hostable one cut off by dead ones ahead of it — `canHost` deliberately runs
 * in TypeScript rather than being re-expressed as SQL, so the scan cannot know
 * which rows it is about to discard. 200 is far past what anybody files: a
 * frequent traveller files a handful a year, and the scan is ordered newest
 * trip first, so the rows that fall off the end are the oldest.
 */
const HOST_SCAN_LIMIT = 200;

/* ─────────────────────────── admission ─────────────────────────── */

/**
 * Refused when the host request has never been filed — the one condition this
 * module adds on top of `canHost`, applied both when listing and when
 * attaching.
 *
 * **Why it is not in `room-share-policy.ts`.** That module's `canHost`
 * deliberately admits a `Draft` host and says so in its own test ("every other
 * status is alive — Draft, Submitted, Completed, Returned may all host"): it
 * answers "is this request *alive and bookable*", which a draft is. This is a
 * different question — "has this request been filed at all" — and it belongs
 * to the two operations below rather than to the policy, for two reasons that
 * are both about the draft rather than about hosting:
 *
 * - a draft has no `RequestNo`, and the running number is the picker's primary
 *   display field; offering "คำขอฉบับร่าง" as a choice names nothing;
 * - **a draft is hard-deleted by its own owner's ordinary save.**
 *   `collectAndDeleteRequestArtifacts` (`request-service.ts`) issues a real
 *   `DELETE FROM [dbo].[AccRequest]` for a `Draft`/`Returned` AP-17 request —
 *   for a discarded draft group, and for any tab dropped from a group on the
 *   next save. `AccTravelRoomShare`'s two foreign keys are `NO ACTION`, so a
 *   binding naming that request either blocks its owner's save with a raw
 *   foreign-key error or has to be deleted out from under its guest.
 *
 * `Returned` is deliberately still offered, because `canHost` admits it and
 * narrowing further than the two reasons above justify would be inventing
 * policy. It carries the same hard-delete exposure a draft does, which is
 * handled where the delete happens rather than by hiding the request — see
 * `collectAndDeleteRequestArtifacts`'s own note.
 */
export const HOST_NOT_FILED_MESSAGE =
  "ไม่สามารถเลือกคำขอฉบับร่างเป็นห้องพักร่วมได้ — เจ้าของคำขอต้องส่งคำขอก่อน";

function hostHasBeenFiled(candidate: ShareCandidate): boolean {
  return candidate.status !== "Draft";
}

/**
 * A policy refusal as the error the route should answer with.
 *
 * Exhaustive over `ShareRefusalCode`, which is exactly what Task 2 made that
 * union closed for: a reason added there without a status here is a compile
 * error rather than a silently-400'd refusal.
 *
 * Every host-state refusal is a **409**. Reaching one means either the picker's
 * list was stale (the host was cancelled, or became somebody's guest, between
 * the list and the click) or the request was hand-made; the client's remedy is
 * the same in both cases — reload the list — and 400's retry affordance is
 * wrong for both. `self_attach` is the one that is plain bad input, and it
 * falls through to `statusForAccError`'s 400.
 */
function refusalError(refusal: ShareRefusal): Error {
  switch (refusal.code) {
    case "self_attach":
      return new Error(refusal.message);
    case "host_not_alive":
    case "host_no_room":
    case "host_is_guest":
    case "guest_already_hosts":
    case "guest_has_host":
      return new AccConflictError(refusal.message);
    default: {
      const never: never = refusal.code;
      return new Error(String(never));
    }
  }
}

/* ─────────────────────────── candidate loading ─────────────────────────── */

interface CandidateRow {
  Id: number;
  RequestNo: string | null;
  Status: string;
  NeedsRoomBooking: boolean | null;
}

/**
 * What one candidate read answers: the candidates themselves, and — separately
 * — **which host each of them currently has**.
 *
 * `ShareCandidate.isGuest` says *that* a request is somebody's guest, which is
 * all `canHost` and `canAttach` need and all they should be given. But
 * `applyRoomShareSelection` has to tell "already attached to exactly the host
 * being saved" (do nothing, and mail nobody again) from "attached to a
 * different one" (replace), and that is a different question.
 *
 * It rides on this read rather than being a second query **because of lock
 * order.** The locked read takes `UPDLOCK, HOLDLOCK` on `AccRequest` first and
 * on `AccTravelRoomShare` second, which is the order the cascade
 * (`applyRoomShareDeath`, inside the host's own transaction) already takes
 * them in. A separate share-row read or delete placed *before* it would invert
 * that — we would hold a guest's share row and want the host's `AccRequest`
 * row while the cascade held the host's `AccRequest` row and wanted that same
 * share row — which is a deadlock, not a slow path. Keeping it on this one
 * read also keeps `{ lock: true }` to the single call site
 * `room-share-response-shape-guard.test.ts` counts.
 *
 * Deliberately NOT a field on `ShareCandidate`: that type is the pure policy's
 * input, and a host id is not something `canHost` or `canAttach` may branch on.
 */
interface ShareCandidateRead {
  candidates: Map<number, ShareCandidate>;
  /** `GuestRequestId` → its current `HostRequestId`. Absent for a request that is nobody's guest. */
  hostOf: Map<number, number>;
}

/**
 * Build a `ShareCandidate` for each of `requestIds`, straight from the
 * database.
 *
 * **One loader, two callers — the picker's filter and the attach re-check** —
 * so the list and the action can never disagree about what a candidate *is*.
 * Ids naming no AP-17 request are simply absent from the map; the caller
 * decides what that means, which differs (the picker skips it, the attach
 * refuses).
 *
 * `lock` takes `UPDLOCK, HOLDLOCK` on the `AccRequest` rows and on the share
 * rows, and is passed by `applyRoomShareSelection` alone. That is what stops
 * the host being cancelled, or becoming somebody else's guest, between this
 * read and the `INSERT` in the same transaction: the host's own cancellation
 * path `UPDATE`s that `AccRequest` row, so it blocks until the save commits
 * and then sees the new guest. On a pool the hint would be pointless
 * contention, which is why the picker does not ask for it.
 *
 * **`AccRequest` first, `AccTravelRoomShare` second, and that order is the
 * reason `hostOf` rides on this read.** The cascade
 * (`applyRoomShareDeath`) takes them in exactly this order from inside the
 * host's own transaction. A share-row read or delete placed *before* this
 * would invert it and deadlock against that cascade rather than merely
 * queue behind it.
 *
 * The join to `AccTravelBooking` is a `LEFT JOIN` on purpose: a request with no
 * booking row yields `needsRoomBooking: false`, which `canHost` refuses with
 * "this request has no room booking" — an answer. An `INNER JOIN` would make
 * the row vanish instead, which reads as "no such request" and is a different,
 * wrong thing to tell somebody.
 */
async function loadShareCandidates(
  runner: SqlRunner,
  requestIds: readonly number[],
  opts?: { lock?: boolean },
): Promise<ShareCandidateRead> {
  const out = new Map<number, ShareCandidate>();
  const hostOf = new Map<number, number>();
  if (requestIds.length === 0) return { candidates: out, hostOf };

  const lockHint = opts?.lock ? " WITH (UPDLOCK, HOLDLOCK)" : "";

  const req = runner.request().input("form", sql.NVarChar, AP17_FORM_CODE);
  const placeholders = requestIds.map((id, i) => {
    req.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const idList = placeholders.join(", ");

  const rows = await req.query(`
    SELECT ${CANDIDATE_COLUMNS}
      FROM [dbo].[AccRequest] r${lockHint}
      LEFT JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
     WHERE r.FormCode = @form
       AND r.Id IN (${idList})
  `);

  // One read answers both `isGuest` (this request is somebody's guest) and
  // `hostsFor` (somebody is this request's guest). Both are needed: `canHost`
  // reads the first, `canAttach` reads the second on the guest side, and a
  // candidate built with `hostsFor: []` because the caller "only needs
  // canHost" would be a lie the next caller inherits.
  const shareReq = runner.request();
  requestIds.forEach((id, i) => shareReq.input(`sid${i}`, sql.Int, id));
  const shareList = requestIds.map((_, i) => `@sid${i}`).join(", ");
  const shares = await shareReq.query(`
    SELECT GuestRequestId, HostRequestId
      FROM [dbo].[AccTravelRoomShare]${lockHint}
     WHERE GuestRequestId IN (${shareList})
        OR HostRequestId IN (${shareList})
  `);

  const guestOf = new Map<number, boolean>();
  const hostsFor = new Map<number, number[]>();
  for (const s of shares.recordset as { GuestRequestId: number; HostRequestId: number }[]) {
    guestOf.set(s.GuestRequestId, true);
    // Which host, not merely that there is one — see `ShareCandidateRead`.
    hostOf.set(s.GuestRequestId, s.HostRequestId);
    const list = hostsFor.get(s.HostRequestId) ?? [];
    list.push(s.GuestRequestId);
    hostsFor.set(s.HostRequestId, list);
  }

  for (const row of rows.recordset as CandidateRow[]) {
    out.set(row.Id, {
      requestId: row.Id,
      requestNo: row.RequestNo ?? null,
      status: String(row.Status ?? ""),
      needsRoomBooking: row.NeedsRoomBooking === true,
      isGuest: guestOf.get(row.Id) === true,
      hostsFor: hostsFor.get(row.Id) ?? [],
    });
  }
  return { candidates: out, hostOf };
}

/* ─────────────────────────── the narrow display read ─────────────────────────── */

/**
 * The picker's three fields, for requests that have **already** been admitted.
 *
 * Both queries interpolate one of the two column constants above and nothing
 * else, and this is the only function in the module that produces a
 * `HostCandidateRow`. Everything the endpoint answers comes from here.
 */
async function loadHostDisplayRows(
  runner: SqlRunner,
  requestIds: readonly number[],
): Promise<Map<number, HostCandidateRow>> {
  const out = new Map<number, HostCandidateRow>();
  if (requestIds.length === 0) return out;

  const req = runner.request().input("form", sql.NVarChar, AP17_FORM_CODE);
  const ids = requestIds.map((id, i) => {
    req.input(`d${i}`, sql.Int, id);
    return `@d${i}`;
  });
  const res = await req.query(`
    SELECT ${HOST_DISPLAY_COLUMNS}
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
     WHERE r.FormCode = @form
       AND r.Id IN (${ids.join(", ")})
  `);

  for (const row of res.recordset as {
    Id: number;
    RequestNo: string | null;
    StaffId: number | null;
    BrandCode: string | null;
    DepartDate: Date | null;
    ReturnDate: Date | null;
    ReasonId: number | null;
    ReasonCustomText: string | null;
    WorkDetail: string | null;
  }[]) {
    out.set(row.Id, {
      requestId: row.Id,
      requestNo: row.RequestNo ?? null,
      departDate: row.DepartDate ? toYmd(row.DepartDate) : null,
      returnDate: row.ReturnDate ? toYmd(row.ReturnDate) : null,
      workLocations: [],
      // Added 2026-09-23 with the user's decision to widen — see
      // `HostCandidateRow`'s own docblock for what each one is for and what
      // it costs. `?? null` throughout rather than a default, because a
      // missing value here is a fact about the host's request and the
      // prefill treats absence as "fill nothing".
      staffId: row.StaffId ?? null,
      brandCode: row.BrandCode ?? null,
      reasonId: row.ReasonId ?? null,
      reasonCustomText: row.ReasonCustomText ?? null,
      workDetail: row.WorkDetail ?? null,
    });
  }

  const locReq = runner.request();
  const locIds = requestIds.map((id, i) => {
    locReq.input(`l${i}`, sql.Int, id);
    return `@l${i}`;
  });
  const locs = await locReq.query(`
    SELECT ${HOST_LOCATION_COLUMNS}
      FROM [dbo].[AccTravelWorkLocation] w
      INNER JOIN [dbo].[AccTravelBooking] t ON t.Id = w.TravelBookingId
     WHERE t.RequestId IN (${locIds.join(", ")})
     ORDER BY w.SortOrder, w.Id
  `);
  for (const row of locs.recordset as {
    RequestId: number;
    Name: string | null;
    Lat: number | null;
    Lng: number | null;
  }[]) {
    const target = out.get(row.RequestId);
    if (!target) continue;
    // Still keyed on the NAME being present: an unnamed row names nothing on
    // screen and fills nothing. The pin rides along and may legitimately be
    // null — every location filed before 2026-09-01 has none (migration 135
    // added the columns with no backfill, and nothing can backfill them
    // because the Google key is HTTP-referrer restricted). The prefill drops
    // those rather than copying a place that cannot be submitted.
    if (row.Name) {
      target.workLocations.push({
        name: row.Name,
        lat: row.Lat ?? null,
        lng: row.Lng ?? null,
      });
    }
  }

  return out;
}

/* ─────────────────────────── the picker's list ─────────────────────────── */

/**
 * What narrows the picker's list.
 *
 * Every date here is a `YYYY-MM-DD` string that has **already been validated**
 * by the route, which refuses a malformed one with a 400 rather than coercing
 * it: `new Date("2026-8-31")` parses, and answering a question about one day
 * with another day's rows is the class of failure `fx-cache-policy.ts` already
 * documents. Nothing in this module re-parses them — they go straight to
 * `sql.Date` as bound parameters.
 */
export interface HostSearchFilters {
  /** HR StaffId of the colleague whose requests are being listed. Required — there is no "list everyone" mode. */
  staffId: number;
  /**
   * The guest's own request, never offered as its own host — **null while the
   * tab has not been saved**, which since 2026-09-22 is an ordinary state
   * rather than one the picker refuses to open in. It only ever removes a row,
   * so a caller that cannot supply it loses a nicety and nothing else:
   * `canAttach` still refuses `self_attach` at the save.
   */
  excludeRequestId: number | null;
  /**
   * The travel-date window the picker is showing. Overlap, not equality: a host
   * whose trip merely touches it is still the right room.
   *
   * **It no longer opens on the guest's own dates.** Spec §6 seeded it from
   * them ("the overwhelmingly common case is two people on the same trip"),
   * which made sense while the guest's dates were the fixed thing. Since the
   * picker writes the *host's* dates into the guest's tab on pick (2026-09-22,
   * final review I4), the dates flow the other way and the filter opens on
   * today … today + 30 instead — `defaultHostFilterRange`, client-side, which
   * is also the only sensible default now that the picker opens on a tab that
   * may have no dates at all yet.
   */
  travelFrom: string | null;
  travelTo: string | null;
  /** Filed-on range, the fallback for somebody who knows when the colleague filed but not when they travel. */
  requestedFrom: string | null;
  requestedTo: string | null;
}

/**
 * One colleague's AP-17 requests that can host a room share (spec §6).
 *
 * Three steps, deliberately not one query:
 *
 * 1. scan that person's requests, newest trip first, capped at
 *    `HOST_SCAN_LIMIT`, applying only the *filters* — the person and the dates;
 * 2. build a `ShareCandidate` for each and keep the ones **`canHost` admits**
 *    and `hostHasBeenFiled` allows. The three conditions spec §6 names (alive,
 *    not already a guest, `needsRoomBooking = true`) are `canHost`'s and are
 *    deliberately not re-expressed as SQL: the attach path asks the same
 *    function about the same candidate shape, so the list and the action cannot
 *    drift apart;
 * 3. read the display columns for the survivors alone.
 *
 * Matching is on `AccRequest.StaffId`, not StaffId-or-EmployeeId as
 * `requester-trips.ts` does, because the input is a person the picker chose out
 * of HR — a StaffId is the only thing it has. A request of theirs written with
 * a null `StaffId` is therefore not offered; it is also one nothing else in
 * AP-17 would attribute to them on screen.
 */
export async function loadHostableRequests(
  filters: HostSearchFilters,
): Promise<HostCandidateRow[]> {
  const pool = await getAccPool();

  const scan = pool
    .request()
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .input("staffId", sql.Int, filters.staffId)
    .input("limit", sql.Int, HOST_SCAN_LIMIT);

  const where: string[] = ["r.FormCode = @form", "r.StaffId = @staffId"];

  if (filters.excludeRequestId != null) {
    scan.input("exclude", sql.Int, filters.excludeRequestId);
    where.push("r.Id <> @exclude");
  }
  // Overlap: the host's trip must not end before the guest's starts, nor start
  // after it ends. Either bound alone still narrows, which is what a requester
  // who has filled in only one of their own two dates has to offer.
  if (filters.travelFrom) {
    scan.input("travelFrom", sql.Date, filters.travelFrom);
    where.push("(t.ReturnDate IS NULL OR t.ReturnDate >= @travelFrom)");
  }
  if (filters.travelTo) {
    scan.input("travelTo", sql.Date, filters.travelTo);
    where.push("(t.DepartDate IS NULL OR t.DepartDate <= @travelTo)");
  }
  if (filters.requestedFrom) {
    scan.input("requestedFrom", sql.Date, filters.requestedFrom);
    where.push("r.CreatedAt >= @requestedFrom");
  }
  if (filters.requestedTo) {
    scan.input("requestedTo", sql.Date, filters.requestedTo);
    // Inclusive of the whole named day — CreatedAt is a datetime2, so a plain
    // `<= @requestedTo` would drop everything filed after midnight on it.
    where.push("r.CreatedAt < DATEADD(DAY, 1, @requestedTo)");
  }

  const scanned = await scan.query(`
    SELECT TOP (@limit) r.Id
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
     WHERE ${where.join(" AND ")}
     ORDER BY t.DepartDate DESC, r.Id DESC
  `);
  const scannedIds = (scanned.recordset as { Id: number }[]).map((r) => r.Id);
  if (scannedIds.length === 0) return [];

  const { candidates } = await loadShareCandidates(pool, scannedIds);
  const admitted: number[] = [];
  for (const id of scannedIds) {
    const candidate = candidates.get(id);
    if (!candidate) continue;
    if (!hostHasBeenFiled(candidate)) continue;
    if (canHost(candidate) !== null) continue;
    admitted.push(id);
  }
  if (admitted.length === 0) return [];

  const display = await loadHostDisplayRows(pool, admitted);
  const out: HostCandidateRow[] = [];
  for (const id of admitted) {
    const row = display.get(id);
    if (row) out.push(row);
  }
  return out;
}

/* ─────────────────────────── one request, by its running number ─────────────────────────── */

/**
 * What `loadHostByRequestNo` can answer.
 *
 * Three outcomes rather than a nullable row, because **"no such number" and
 * "that number names a request you may not share" are different answers and
 * the requester has to be able to tell them apart** (the second tab's whole
 * point: a typo and a cancelled colleague need different next actions).
 *
 * `not_hostable.message` is the **policy's own sentence, carried verbatim** —
 * `canHost`'s refusal, or `HOST_NOT_FILED_MESSAGE`, or `SELF_ATTACH_MESSAGE`.
 * `ShareRefusalCode` stays closed and nothing new is written beside it; only
 * `not_found` has copy of its own, and it belongs to the route because it is
 * not a policy refusal at all.
 */
export type HostLookupResult =
  | { kind: "found"; host: HostCandidateRow }
  | { kind: "not_found" }
  | { kind: "not_hostable"; message: string };

/**
 * One AP-17 request named by its running number, if it can host.
 *
 * **This is a by-number read of a request the caller names, and that is new
 * reach on top of the person-and-date scan above.** The route's docblock
 * states the residual in full; what belongs here is that it answers the *same*
 * `HostCandidateRow` — whatever that shape currently holds, from
 * `loadHostDisplayRows` and nothing else, which is why the shape is stated in
 * exactly one place — and applies the
 * *same* two admission rules `loadHostableRequests` applies, in the same
 * order, so a number cannot reach a request the list would have hidden.
 *
 * **The widening of 2026-09-23 landed here too, and it bites hardest here.**
 * The list is reached through a person; this is reached through a sequential
 * identifier. See `HostCandidateRow` and the route's docblock.
 *
 * `excludeRequestId` is the caller's own tab. It is refused with
 * `SELF_ATTACH_MESSAGE` **before any row is read**, deliberately: building a
 * `ShareCandidate` for it to let `canAttach` phrase the refusal would mean
 * loading a request the caller merely named and reading its guest/host state
 * back to them. A skip cannot leak; a refusal derived from the row could.
 */
export async function loadHostByRequestNo(
  requestNo: string,
  excludeRequestId: number | null,
): Promise<HostLookupResult> {
  const trimmed = requestNo.trim();
  if (trimmed.length === 0) return { kind: "not_found" };

  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .input("no", sql.NVarChar(50), trimmed)
    .query(`SELECT TOP (1) r.Id
              FROM [dbo].[AccRequest] r
             WHERE r.FormCode = @form
               AND r.RequestNo = @no`);
  const row = res.recordset[0] as { Id: number } | undefined;
  if (!row) return { kind: "not_found" };

  if (excludeRequestId != null && row.Id === excludeRequestId) {
    return { kind: "not_hostable", message: SELF_ATTACH_MESSAGE };
  }

  const { candidates } = await loadShareCandidates(pool, [row.Id]);
  const candidate = candidates.get(row.Id);
  // A request with no `AccTravelBooking` row still produces a candidate (the
  // join is a LEFT JOIN), so this is only reachable if the row vanished
  // between the two reads — answered as the number naming nothing, which by
  // then it does.
  if (!candidate) return { kind: "not_found" };
  if (!hostHasBeenFiled(candidate)) {
    return { kind: "not_hostable", message: HOST_NOT_FILED_MESSAGE };
  }
  const refusal = canHost(candidate);
  if (refusal) return { kind: "not_hostable", message: refusal.message };

  const display = await loadHostDisplayRows(pool, [row.Id]);
  const host = display.get(row.Id);
  if (!host) return { kind: "not_found" };
  return { kind: "found", host };
}

/* ─────────────────────────── the guest's own binding ─────────────────────────── */

/**
 * The share this request is a guest of, or null.
 *
 * Reads through the same narrow display columns the picker does, so what a
 * guest sees about their host after attaching is exactly what they were shown
 * before it.
 */
export async function loadRoomShare(guestRequestId: number): Promise<RoomShareView | null> {
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("gid", sql.Int, guestRequestId)
    .query(`SELECT HostRequestId, HostStaffId
              FROM [dbo].[AccTravelRoomShare]
             WHERE GuestRequestId = @gid`);
  const row = res.recordset[0] as { HostRequestId: number; HostStaffId: number | null } | undefined;
  if (!row) return null;

  const display = await loadHostDisplayRows(pool, [row.HostRequestId]);
  const host = display.get(row.HostRequestId);
  if (!host) return null;

  return {
    guestRequestId,
    hostStaffId: row.HostStaffId ?? null,
    host,
  };
}

/**
 * The guest's request must be theirs and still editable — **the existing
 * `Draft`/`Returned` rule**, not a second one.
 *
 * `EDITABLE_STATUSES` and `ACL_NOT_EDITABLE` are `request-acl-policy.ts`'s own,
 * the same pair `decideRequestMutate` applies and the same copy it answers
 * with. The route has already run that whole decision through
 * `authorizeAccRequest(…, "mutate")`; this is the in-transaction re-assertion
 * of it, under `UPDLOCK, HOLDLOCK`, because the route's verdict was taken
 * before the transaction opened and a submit landing in between must not be
 * overtaken.
 *
 * Which is also why the two arms answer differently. Failing the *ownership*
 * arm here means the route's own check was bypassed, so it stays a 403. Failing
 * the *status* arm means the row moved under a check that had just passed —
 * that is a race, and 409's "reload" is the honest answer rather than 403's
 * "you may not".
 */
async function requireEditableGuest(
  tx: SqlRunner,
  guestRequestId: number,
  userId: number,
): Promise<void> {
  const res = await tx
    .request()
    .input("gid", sql.Int, guestRequestId)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`SELECT Status, CreatedBy
              FROM [dbo].[AccRequest] WITH (UPDLOCK, HOLDLOCK)
             WHERE Id = @gid AND FormCode = @form`);
  const row = res.recordset[0] as { Status: string; CreatedBy: number | null } | undefined;
  if (!row) throw new AccForbiddenError("ไม่พบคำขอนี้");
  if (row.CreatedBy == null || row.CreatedBy !== userId) {
    throw new AccForbiddenError("ไม่มีสิทธิ์แก้ไขคำขอนี้");
  }
  if (!EDITABLE_STATUSES.includes(row.Status)) {
    throw new AccConflictError(NOT_EDITABLE_MESSAGE);
  }
}

/** SQL Server's two unique-violation codes — a racing second attach, not a bug. */
function isUniqueViolation(err: unknown): boolean {
  const n = (err as { number?: number } | null)?.number;
  return n === 2601 || n === 2627;
}

/**
 * Write, replace or clear this guest's binding — **on the caller's open
 * transaction, as part of saving the tab.**
 *
 * ## Why this is not an endpoint any more
 *
 * It replaces `attachRoomShare` and `detachRoomShare`, which each opened a
 * transaction of their own behind a `POST`/`DELETE` that fired the moment a
 * host was clicked. That shape forced the picker to demand a saved draft
 * first — an unsaved tab has no `AccRequest.Id` to post to — and the user
 * asked twice (2026-09-22) for that step to go. Picking a host is now
 * ordinary tab state, exactly like the accommodation it replaces, and
 * `saveTravelBookingDraft` persists it with everything else.
 *
 * **Every admission decision is still re-taken from the database here**, not
 * carried from the picker:
 *
 * - the guest is still theirs and still editable (`requireEditableGuest`) —
 *   the same `Draft`/`Returned` rule `decideRequestMutate` applies, which the
 *   save's route and the group guard above have each already applied once;
 * - the host still exists, is still AP-17, has still been filed, and
 *   `canAttach(guest, host)` still answers null — with both rows locked, so a
 *   cancellation racing this save either commits first and is seen, or waits
 *   and then sees the guest.
 *
 * A form left open while the host was cancelled therefore cannot slip past.
 *
 * ## The three shapes, and the one that costs nothing
 *
 * - **unchanged** — the stored host is already the one being saved. Returns
 *   immediately, writes nothing and **mails nobody**: an ordinary re-save of a
 *   guest tab must not tell the host again, and must not churn `CreatedBy` or
 *   `CreatedAt`. This is also the cheap path for every tab that has no binding
 *   and wants none, which is nearly every tab of nearly every save — one
 *   `SELECT`, no lock, no write.
 * - **cleared** (`hostRequestId` null over a stored row) — the row is deleted.
 *   Nothing is restored: the requester is put back at an unanswered
 *   ที่พักค้างคืน, which is the honest state, and resurrecting the choice the
 *   attach replaced would re-book a room they had decided against.
 * - **set or replaced** — refuse, or delete-then-insert.
 *
 * **Replacing used to be impossible and now is not**, deliberately. The old
 * `POST` refused a guest that already had a host (`canAttach`'s
 * `guest_has_host`), so changing your mind meant `DELETE` then `POST`. Here
 * both halves are one transaction, and `canAttach` is asked about the guest
 * **as it will be once the old row is gone** — `isGuest: false`, which is not
 * a convenient fiction but the state this function is about to commit, and
 * the only field of the candidate the delete changes. `hostsFor` is rows where
 * the guest is the *host*, which deleting its own guest row cannot touch, so
 * the one-hop check is untouched and still answers from the locked read.
 * `UQ_AccTravelRoomShare_Guest` remains the backstop.
 *
 * `HostStaffId` is filled from the host's own `AccRequest.StaffId` in the
 * `INSERT` itself rather than from anything the caller sent — it is display
 * data, and the one thing worse than a stale label is a caller-chosen one.
 *
 * ## It does not drain the mail queue, and must not
 *
 * `queueRoomShareAttachedMail` writes its row on `tx`, so the notice and the
 * binding stand or fall together (spec §5: telling the host is the entire
 * protection, since §2 declined to ask their consent). Draining is
 * `saveTravelBookingDraft`'s unconditional `processQueue()` **after the
 * commit** — the same call the two cascades already rely on. Draining from in
 * here would try to send a notice about a binding that has not committed yet.
 */
export async function applyRoomShareSelection(
  tx: SqlRunner,
  input: {
    guestRequestId: number;
    /** The tab's chosen host, or null to clear. Never `undefined` — the caller decides what an absent field means. */
    hostRequestId: number | null;
    userId: number;
  },
): Promise<{ changed: boolean }> {
  /* The cheap path, and the reason a save of five ordinary tabs costs five
     SELECTs rather than five locked reads and five no-op DELETEs. Unlocked on
     purpose: it decides only whether to do nothing, and nothing is what a
     stale answer would also lead to. The one thing that can move these rows
     underneath it is the host-death cascade, which mails the guest about
     exactly that. */
  const currentRes = await tx
    .request()
    .input("gid", sql.Int, input.guestRequestId)
    .query(`SELECT HostRequestId
              FROM [dbo].[AccTravelRoomShare]
             WHERE GuestRequestId = @gid`);
  const currentHostId =
    (currentRes.recordset[0]?.HostRequestId as number | undefined) ?? null;
  if (currentHostId === input.hostRequestId) return { changed: false };

  await requireEditableGuest(tx, input.guestRequestId, input.userId);

  if (input.hostRequestId === null) {
    await tx
      .request()
      .input("gid", sql.Int, input.guestRequestId)
      .query(`DELETE FROM [dbo].[AccTravelRoomShare] WHERE GuestRequestId = @gid`);
    return { changed: true };
  }

  const hostRequestId = input.hostRequestId;
  const { candidates } = await loadShareCandidates(
    tx,
    [input.guestRequestId, hostRequestId],
    { lock: true },
  );
  const guest = candidates.get(input.guestRequestId);
  const host = candidates.get(hostRequestId);
  if (!guest) throw new AccForbiddenError("ไม่พบคำขอนี้");
  // Deliberately the same wording whether the id names nothing at all or
  // names a request of another form: a save must not confirm that some
  // arbitrary id exists.
  if (!host) throw new AccConflictError("ไม่พบคำขอที่ต้องการพักห้องร่วมด้วย");
  if (!hostHasBeenFiled(host)) throw new AccConflictError(HOST_NOT_FILED_MESSAGE);

  // The guest as it will be once the row below is deleted — see the header.
  const guestAfterClear: ShareCandidate =
    currentHostId === null ? guest : { ...guest, isGuest: false };
  const refusal = canAttach(guestAfterClear, host);
  // Decided BEFORE anything is deleted, so a refusal leaves the existing
  // binding in place without relying on the caller's rollback to put it back.
  if (refusal) throw refusalError(refusal);

  try {
    if (currentHostId !== null) {
      await tx
        .request()
        .input("gid", sql.Int, input.guestRequestId)
        .query(`DELETE FROM [dbo].[AccTravelRoomShare] WHERE GuestRequestId = @gid`);
    }

    await tx
      .request()
      .input("gid", sql.Int, input.guestRequestId)
      .input("hid", sql.Int, hostRequestId)
      .input("by", sql.Int, input.userId)
      .query(`INSERT INTO [dbo].[AccTravelRoomShare]
                (GuestRequestId, HostRequestId, HostStaffId, CreatedBy)
              SELECT @gid, @hid, r.StaffId, @by
                FROM [dbo].[AccRequest] r
               WHERE r.Id = @hid`);
  } catch (e) {
    if (isUniqueViolation(e)) {
      // `UQ_AccTravelRoomShare_Guest` is the backstop `canAttach`'s
      // `guest_has_host` refusal normally speaks for; reaching it means two
      // saves raced. Same message, so the requester reads one answer.
      throw new AccConflictError("คำขอนี้แนบกับห้องพักร่วมอื่นอยู่แล้ว — กรุณาโหลดหน้านี้ใหม่");
    }
    throw e;
  }

  /* THE GUEST BOOKS NOTHING THEMSELVES (spec §1), and until final review I1
     that was enforced only by a React state patch — so a reload between the
     attach and the next save restored the accommodation from the server,
     into a grid `isRoomShareGuest` hides, and the next save posted it back
     and had the Admin desk book a real room for somebody sharing one.
     Cleared on `tx`, so the binding and the withdrawal of the room it
     replaces commit or roll back together. **It runs AFTER
     `upsertTravelBooking` has written this tab** — the caller's own ordering
     note says why: this clear must be the last word on those four columns,
     not a value the save then writes over. See `room-share-guest-room.ts`
     for the whole argument, including why it is a separate module. */
  await clearGuestOwnAccommodation(tx, input.guestRequestId);

  await queueRoomShareAttachedMail(tx, {
    guestRequestId: input.guestRequestId,
    hostRequestId,
  });

  return { changed: true };
}

/* ─────────────────────────── the cascade's loader ─────────────────────────── */

/**
 * Every request attached to this host, in the shape the cascade decides on.
 *
 * **Takes a runner, not a pool** — Task 6 calls it inside the transaction that
 * is cancelling or re-dating the host, which is the whole safety property of
 * the cascade (spec §4: if it fails, the host's own cancellation rolls back).
 * A loader that opened its own pool connection would read the state from
 * *outside* that transaction and miss the change it is reacting to.
 *
 * `LEFT JOIN` to `AccTravelBooking`, and a null date becomes `""` rather than
 * dropping the row: a guest the cascade cannot see is a guest that survives its
 * dead host, which is the one outcome this feature exists to prevent. `""`
 * never equals the host's dates, so `cascadeForHostDates` produces a `redate`
 * that fills them in, and `cascadeForHostDeath` does not read dates at all.
 */
export async function loadGuestsOf(
  runner: SqlRunner,
  hostRequestId: number,
): Promise<GuestState[]> {
  const res = await runner
    .request()
    .input("hid", sql.Int, hostRequestId)
    .query(`SELECT s.GuestRequestId, r.RequestNo, r.Status, t.DepartDate, t.ReturnDate
              FROM [dbo].[AccTravelRoomShare] s
              INNER JOIN [dbo].[AccRequest] r ON r.Id = s.GuestRequestId
              LEFT JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
             WHERE s.HostRequestId = @hid
             ORDER BY s.Id`);

  return (res.recordset as {
    GuestRequestId: number;
    RequestNo: string | null;
    Status: string;
    DepartDate: Date | null;
    ReturnDate: Date | null;
  }[]).map((row) => ({
    requestId: row.GuestRequestId,
    requestNo: row.RequestNo ?? null,
    status: String(row.Status ?? ""),
    departDate: row.DepartDate ? toYmd(row.DepartDate) : "",
    returnDate: row.ReturnDate ? toYmd(row.ReturnDate) : "",
  }));
}
