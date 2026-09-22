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
 * - `loadRoomShare` / `attachRoomShare` / `detachRoomShare` — the guest's own
 *   binding;
 * - `loadGuestsOf` — every guest of one host, for the cascade (spec §4).
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
 * both sites (the listing and the attach re-check), because a list and an
 * action that disagree about what is offerable is exactly the shape of bug
 * this feature cannot afford.
 */

import { getAccPool, sql } from "@/lib/acc/pool";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import { AccConflictError, AccForbiddenError } from "@/lib/acc/request-errors";
import { ACL_NOT_EDITABLE, EDITABLE_STATUSES } from "@/lib/acc/request-acl-policy";
import {
  canAttach,
  canHost,
  type ShareCandidate,
  type ShareRefusal,
} from "@/lib/acc/travel-booking/room-share-policy";
import type { GuestState } from "@/lib/acc/travel-booking/room-share-cascade";

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
 * Spec §6 names exactly three things the picker needs: the running number, the
 * travel dates and the work location. `requestId` is the fourth field and is
 * not a fourth fact — it is the handle the picker posts back to `attach`.
 *
 * **Not the amount, not the attachments, not the ID card, not the requester's
 * other fields.** Listing another person's requests is new reach in this
 * application, so the shape is built from an explicit column list
 * (`HOST_DISPLAY_COLUMNS`) rather than from a `SELECT *` or a reuse of
 * `getTravelBookingRequest`'s read shape — the latter being how a field nobody
 * intended to expose arrives by inheritance. `room-share-response-shape-guard.test.ts`
 * asserts both halves: these keys, and those columns.
 */
export interface HostCandidateRow {
  requestId: number;
  requestNo: string | null;
  departDate: string | null;
  returnDate: string | null;
  /** `AccTravelWorkLocation.Name` only — never the coordinates, which the picker does not draw. */
  workLocations: string[];
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
 * `canHost`, so a request the caller may not be offered never has its dates
 * fetched at all.
 */
const HOST_DISPLAY_COLUMNS = "r.Id, r.RequestNo, t.DepartDate, t.ReturnDate";

/** The second and last list feeding the response: a work location's name, and the request it hangs off. */
const HOST_LOCATION_COLUMNS = "t.RequestId, w.Name";

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
 * rows, and is passed by `attachRoomShare` alone. That is what stops the host
 * being cancelled, or becoming somebody else's guest, between this read and
 * the `INSERT` in the same transaction: the host's own cancellation path
 * `UPDATE`s that `AccRequest` row, so it blocks until the attach commits and
 * then sees the new guest. On a pool the hint would be pointless contention,
 * which is why the picker does not ask for it.
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
): Promise<Map<number, ShareCandidate>> {
  const out = new Map<number, ShareCandidate>();
  if (requestIds.length === 0) return out;

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
  return out;
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
    DepartDate: Date | null;
    ReturnDate: Date | null;
  }[]) {
    out.set(row.Id, {
      requestId: row.Id,
      requestNo: row.RequestNo ?? null,
      departDate: row.DepartDate ? toYmd(row.DepartDate) : null,
      returnDate: row.ReturnDate ? toYmd(row.ReturnDate) : null,
      workLocations: [],
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
  for (const row of locs.recordset as { RequestId: number; Name: string | null }[]) {
    const target = out.get(row.RequestId);
    if (!target) continue;
    if (row.Name) target.workLocations.push(row.Name);
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
  /** The guest's own request, never offered as its own host. */
  excludeRequestId: number | null;
  /**
   * The guest's travel dates — the default filter (spec §6: "the overwhelmingly
   * common case is two people on the same trip"). Overlap, not equality: a host
   * whose trip merely touches the guest's is still the right room.
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

  const candidates = await loadShareCandidates(pool, scannedIds);
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
 * Attach `guestRequestId` to `hostRequestId`.
 *
 * **Every admission decision is re-taken from the database inside the
 * transaction that inserts**, not carried from the picker:
 *
 * - the guest is still theirs and still editable (`requireEditableGuest`);
 * - the host still exists, is still AP-17, has still been filed, and
 *   `canAttach(guest, host)` still answers null — with both rows locked, so a
 *   cancellation racing this attach either commits first and is seen, or waits
 *   and then sees the guest.
 *
 * A client that has had the picker open while the host was cancelled therefore
 * cannot slip past. This is the discipline `approveByAccount` already uses for
 * the per-diem dependency gate, and the reason it is not merely a re-run of the
 * same check: the check the route made was against a state that no longer has
 * to hold.
 *
 * `HostStaffId` is filled from the host's own `AccRequest.StaffId` in the
 * `INSERT` itself rather than from anything the caller sent — it is display
 * data, and the one thing worse than a stale label is a caller-chosen one.
 */
export async function attachRoomShare(input: {
  guestRequestId: number;
  hostRequestId: number;
  userId: number;
}): Promise<RoomShareView> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await requireEditableGuest(tx, input.guestRequestId, input.userId);

    const candidates = await loadShareCandidates(
      tx,
      [input.guestRequestId, input.hostRequestId],
      { lock: true },
    );
    const guest = candidates.get(input.guestRequestId);
    const host = candidates.get(input.hostRequestId);
    if (!guest) throw new AccForbiddenError("ไม่พบคำขอนี้");
    // Deliberately the same wording whether the id names nothing at all or
    // names a request of another form: this endpoint must not confirm that
    // some arbitrary id exists.
    if (!host) throw new AccConflictError("ไม่พบคำขอที่ต้องการพักห้องร่วมด้วย");
    if (!hostHasBeenFiled(host)) throw new AccConflictError(HOST_NOT_FILED_MESSAGE);

    const refusal = canAttach(guest, host);
    if (refusal) throw refusalError(refusal);

    const inserted = await tx
      .request()
      .input("gid", sql.Int, input.guestRequestId)
      .input("hid", sql.Int, input.hostRequestId)
      .input("by", sql.Int, input.userId)
      .query(`INSERT INTO [dbo].[AccTravelRoomShare]
                (GuestRequestId, HostRequestId, HostStaffId, CreatedBy)
              OUTPUT INSERTED.HostStaffId AS HostStaffId
              SELECT @gid, @hid, r.StaffId, @by
                FROM [dbo].[AccRequest] r
               WHERE r.Id = @hid`);
    const hostStaffId =
      (inserted.recordset[0]?.HostStaffId as number | null | undefined) ?? null;

    const display = await loadHostDisplayRows(tx, [input.hostRequestId]);
    const hostRow = display.get(input.hostRequestId);
    if (!hostRow) throw new AccConflictError("ไม่พบคำขอที่ต้องการพักห้องร่วมด้วย");

    await tx.commit();
    return { guestRequestId: input.guestRequestId, hostStaffId, host: hostRow };
  } catch (e) {
    await tx.rollback().catch(() => {});
    if (isUniqueViolation(e)) {
      // `UQ_AccTravelRoomShare_Guest` is the backstop `canAttach`'s
      // `guest_has_host` refusal normally speaks for; reaching it means two
      // attaches raced. Same message, so the requester reads one answer.
      throw new AccConflictError("คำขอนี้แนบกับห้องพักร่วมอื่นอยู่แล้ว — กรุณาโหลดหน้านี้ใหม่");
    }
    throw e;
  }
}

/**
 * Undo the attachment while the guest's own request is still editable.
 *
 * Idempotent: detaching something already detached answers `removed: false`
 * rather than throwing, because a double-click and a stale page are the two
 * ways to get here and neither is an error worth showing. The editability rule
 * is re-asserted first all the same — a request past `Returned` must not have
 * its binding removed, since by then the per diem it earned as a guest has been
 * priced on it.
 */
export async function detachRoomShare(input: {
  guestRequestId: number;
  userId: number;
}): Promise<{ removed: boolean }> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await requireEditableGuest(tx, input.guestRequestId, input.userId);
    const res = await tx
      .request()
      .input("gid", sql.Int, input.guestRequestId)
      .query(`DELETE FROM [dbo].[AccTravelRoomShare] WHERE GuestRequestId = @gid;
              SELECT @@ROWCOUNT AS n`);
    const removed = ((res.recordset[0]?.n as number) ?? 0) > 0;
    await tx.commit();
    return { removed };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
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
