import { getAccPool, sql } from "@/lib/acc/pool";
import { continuationFlags, type ChainTrip } from "@/lib/acc/travel-booking/continuation-chain";
import { computePerDiem } from "@/lib/acc/travel-booking/perdiem";
import {
  IS_ROOM_SHARE_GUEST_COLUMN,
  roomBookedOrShared,
} from "@/lib/acc/travel-booking/perdiem-room";
import { getPerDiemEmployeeLog } from "@/lib/acc/travel-booking/allowance-log";
import { uatByRecordId } from "@/lib/acc/travel-booking/perdiem-uat-gate";
import { perDiemLogFor, type PerDiemCountryRate } from "@/lib/acc/travel-booking/perdiem-country";
import { listPerDiemCountryRates } from "@/lib/acc/travel-booking/perdiem-source";
import { perDiemWritable } from "@/lib/acc/travel-booking/perdiem-window";
import { loadRequesterTrips } from "@/lib/acc/travel-booking/requester-trips";

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/**
 * The shape `reimburse/request-service.ts:74` uses — a thing with `.request()`,
 * not `admin-service.ts:109`'s `ReturnType<AccPool["transaction"]>` (the
 * transaction object itself). Declared locally so this module has no
 * dependency on either caller's private type. Structurally identical to
 * `requester-trips.ts`'s own `SqlRunner`, so it is handed straight through to
 * `loadRequesterTrips` with no cast.
 */
type AccTx = { request: () => ReturnType<AccPool["request"]> };

/**
 * Which submission, cancellation or rejection caused a recompute, and its
 * running number for the note. **Exported since 2026-09-22 (I1)**:
 * `submitTravelBookingGroup` (`request-service.ts`) constructs one of these
 * itself, naming the newly filed trip responsible, and needs the type to do
 * it — `"submitted"` is that third case, added the same day. Its own
 * `causeLabel` sits beside the other two below.
 *
 * **`"host_redated"` is the fourth case (AP-17 package E, Task 6).** A
 * พักห้องเดียวกับ host's travel dates changed, so every live guest's dates
 * were rewritten to follow them (`room-share-cascade-apply.ts`) and each
 * guest's own group is repriced against its new span. `cause.requestId` there
 * is the **guest** whose dates moved, not the host — the host is in a
 * different group and a different person's calendar, so naming it would make
 * `recomputeGroupPerDiem`'s `causeDepart` lookup miss and silence the
 * outside-trip arm entirely. The host's running number reaches the timeline
 * through the guest's own `dates_followed_room_share_host` row instead.
 */
export type RecomputeCause = {
  requestId: number;
  requestNo: string | null;
  kind: "cancelled" | "rejected" | "submitted" | "host_redated";
};

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The columns every per-diem read needs — the group's own `GroupKey` SELECT
 * below and `loadOutsideDetailRows`'s outside-row SELECT both build off this,
 * rather than each spelling the list out separately.
 *
 * **This constant is the whole guard, and that is the point of it existing.**
 * `perdiem-source-guard.test.ts` reads this file's source for `r.CountryCode` /
 * `r.StaffId` / `t.NeedsRoomBooking` ANYWHERE in the file, not inside one named
 * query — so with the two SELECTs spelled out separately, "tidying" a column
 * out of only one of them left the guard green while that column's failure
 * mode stayed live on whichever read kept it. One shared list means there is
 * exactly one place to delete a column from, so the guard actually covers both
 * readers rather than only whichever one somebody happened to leave alone.
 *
 * **That guarantee holds only as long as every per-diem SELECT in this file
 * keeps interpolating this constant — nothing enforces that a new one must.**
 * Mutation-verified (whole-branch review, 2026-09-22): a third reader added
 * with its own hand-spelled column list, omitting all three columns above,
 * left `perdiem-source-guard.test.ts` green (11 pass / 0 fail) — the guard
 * reads for the COLUMN NAME anywhere in the file, and the constant's own
 * definition line still contains all three names, which is what it actually
 * matched. So the true invariant is "every SELECT that reads an
 * `AccTravelBooking` row for pricing purposes interpolates
 * `PERDIEM_ROW_COLUMNS`", which is convention, not something this file or its
 * guard can check on its own. A tighter guard asserting that every SELECT
 * naming `AccTravelBooking` also names `${PERDIEM_ROW_COLUMNS}` is written —
 * `perdiem-source-guard.test.ts`'s "every SELECT reading AccTravelBooking …"
 * test — but it is narrower than that sentence promises: it was itself
 * measured (fix round 2, 2026-09-22, N6) to miss the same rogue reader when
 * written with the table's brackets dropped or with its SQL hoisted to a
 * `const` first, before being widened to catch both. Read that test's own
 * docblock before assuming it is airtight.
 *
 * - **`r.CountryCode`** — deleted, `perDiemLogFor` is handed `undefined`,
 *   answers `"employee"`, and every trip this touches whose country is not
 *   Thailand is silently re-priced at the domestic rate — `PerDiemTotal` AND
 *   `AccRequest.TotalAmount`, inside the transaction that is cancelling a
 *   sibling.
 * - **`r.StaffId`** — deleted, the UAT override lookup is handed `undefined`,
 *   finds nothing, and every UAT trip this touches is re-priced at the
 *   tester's REAL HR allowance — same two columns, same transaction.
 * - **`t.NeedsRoomBooking`** — deleted, `!!x.NeedsRoomBooking` reads `false`
 *   for a row that never had the column at all (`!!undefined === false`), so
 *   `computePerDiem` returns `{ days: 0, total: 0 }` for **every** row this
 *   touches — not one class of trip mispriced, every recomputed trip this
 *   transaction writes, group or outside, written at **฿0**. Worse than either
 *   column above, and until this fix it carried neither a comment nor a guard.
 * - **`IS_ROOM_SHARE_GUEST_COLUMN`** (AP-17 package E) — deleted,
 *   `!!x.IsRoomShareGuest` reads `false` for a row that never had the column
 *   (`!!undefined === false`), so every พักห้องเดียวกับ **guest** this
 *   recompute touches is re-priced at **฿0** — a requester who books no room
 *   because they are sharing a colleague's, and whose per diem the user
 *   explicitly said they keep (spec §1), silently loses all of it inside the
 *   transaction that cancels somebody else's trip. Exactly
 *   `t.NeedsRoomBooking`'s failure narrowed to one population, and equally
 *   invisible: the two facts are read together and answered by one predicate,
 *   `roomBookedOrShared`, so dropping either one of them reaches the same
 *   wrong money.
 *
 * None of the four fails a typecheck, and none fails any test but the guard.
 */
const PERDIEM_ROW_COLUMNS =
  "t.RequestId, t.DepartDate, t.ReturnDate, t.IsContinuation, t.PerDiemDays, " +
  "t.PerDiemTotal, t.NeedsRoomBooking, r.Status, r.EmployeeId, r.CountryCode, r.StaffId, " +
  IS_ROOM_SHARE_GUEST_COLUMN;

/**
 * Rewrite one trip's per diem for one continuation-flag change — the body
 * shared by the group's own rows and the outside rows the chain now reaches
 * (`recomputeGroupPerDiem` below), so the two paths can never drift apart.
 *
 * `x` carries the same column shape either way — `RequestId`, `Status`,
 * `DepartDate`, `ReturnDate`, `IsContinuation`, `PerDiemDays`, `PerDiemTotal`
 * plus `PERDIEM_ROW_COLUMNS`'s own `EmployeeId`/`CountryCode`/`StaffId`/
 * `NeedsRoomBooking`/`IsRoomShareGuest` — because both readers, the `GroupKey`
 * SELECT below and `loadOutsideDetailRows`, build their column list off that
 * one constant rather than each naming it separately; the two cannot diverge
 * in shape.
 *
 * No-op (no UPDATE, no audit row) when the flag has not changed — that row was
 * never touched by this cancellation and must not appear in the trail at all.
 *
 * **`forceReprice` is the one thing that overrides that no-op, and it exists
 * because the flag is not the only input that can move (AP-17 package E, Task
 * 6).** Every caller before it changed a trip's per diem by changing its
 * *position in the chain*, so "the flag did not move" and "nothing about this
 * row's price changed" were the same statement. A room-share guest re-dated to
 * follow its host breaks that: its **span** changed, so 20–24 becomes 25–30 and
 * the days count with it, while its continuation flag very often does not move
 * at all. Without this the guest would keep a figure priced for dates it is no
 * longer travelling on — silently, on the path that writes
 * `AccRequest.TotalAmount`.
 *
 * It overrides **only** the flag comparison. `perDiemWritable`'s gate below is
 * untouched, so a `Completed` guest still gets its `locked: true` audit row and
 * no money write — forcing a reprice must never become a way past the rule that
 * an already-paid figure is a person's decision, not a cascade's.
 */
async function rewritePerDiemRow(
  tx: AccTx,
  x: Record<string, unknown>,
  nowContinuation: boolean,
  cause: RecomputeCause,
  loadRates: () => Promise<PerDiemCountryRate[]>,
  forceReprice = false,
): Promise<void> {
  const requestId = x.RequestId as number;
  const status = x.Status as string;
  const wasContinuation = !!x.IsContinuation;
  if (wasContinuation === nowContinuation && !forceReprice) return;

  const beforeDays = (x.PerDiemDays as number) ?? 0;
  const beforeTotal = Number(x.PerDiemTotal ?? 0);
  const departDate = x.DepartDate ? toYmd(x.DepartDate as Date) : null;
  const returnDate = x.ReturnDate ? toYmd(x.ReturnDate as Date) : null;

  // A frozen request still gets its row in the trail — with before === after,
  // and `locked` set — because a figure that *would* have moved is exactly
  // what somebody reconciling this later needs to find. A silent skip leaves
  // nothing to find.
  const writable = perDiemWritable(status) && !!departDate && !!returnDate;

  let afterDays = beforeDays;
  let afterTotal = beforeTotal;
  // Recorded on the audit row: a figure that moved because a country rate
  // applies is a different event from one that moved because a day was given
  // back, and the timeline is where somebody reconciling this will look.
  let rateSource: "country" | "employee" = "employee";
  let rateCountry: string | null = null;

  if (writable) {
    const employeeId = x.EmployeeId as string | null;
    // `uatByRecordId`, NOT resolveFormEnvironment(). This runs inside somebody
    // else's transaction and may have no request scope, where the resolver
    // silently answers Production — which would re-price a UAT trip at real HR
    // and write it to both PerDiemTotal and AccRequest.TotalAmount. The id is
    // exact and needs no headers.
    //
    // It is also what keeps this module's unit test database-free: no fixture
    // RequestId reaches 900000, so the UAT per-diem read is never issued, exactly
    // as `loadRates`'s `country !== "TH"` gate keeps the rate list unread.
    const log = await getPerDiemEmployeeLog(
      employeeId,
      (x.StaffId as number | null) ?? null,
      uatByRecordId(requestId),
    );
    // Same resolver the submit used, handed this trip's own country — so a
    // recompute cannot price a trip differently from the way it was first
    // priced. A trip with no foreign country never loads the rate list at all.
    const country = ((x.CountryCode as string | null) ?? "").trim().toUpperCase();
    const resolved = perDiemLogFor(
      country,
      log,
      country && country !== "TH" ? await loadRates() : [],
    );
    rateSource = resolved.source;
    rateCountry = resolved.countryCode;
    // No room booked, no per diem (2026-09-21) — the same rule the submit
    // applies in `request-service.ts`, read from the persisted flag rather than
    // re-derived, so a trip whose accommodation option never books a room
    // cannot be silently repaid its full per diem the first time anything in
    // its chain is cancelled.
    //
    // **And its one exception, package E**: a พักห้องเดียวกับ guest books no
    // room and IS paid (spec §1). `roomBookedOrShared` is the single predicate
    // the submit, this recompute and the form's live estimate all apply, so a
    // cancellation elsewhere cannot re-price a guest at ฿0 while the submit
    // had stored real money — the two would then disagree with nothing said.
    const computed = computePerDiem(departDate!, returnDate!, nowContinuation, resolved.log, {
      roomBooked: roomBookedOrShared({
        needsRoomBooking: !!x.NeedsRoomBooking,
        isRoomShareGuest: !!x.IsRoomShareGuest,
      }),
    });
    afterDays = computed.days;
    afterTotal = computed.total;

    // Both money figures, one batch, one transaction, one writability rule.
    // `AccRequest.TotalAmount` is the per-diem total surfaced on every list
    // row — `submitTravelBookingGroup` stamps it at submit and nothing else
    // ever wrote it, so a day given back moved `AccTravelBooking.PerDiemTotal`
    // and left My Requests, My Work and the header showing the
    // pre-cancellation figure for good, disagreeing with the accounting queue
    // and the report, which read the detail row.
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("cont", sql.Bit, nowContinuation ? 1 : 0)
      .input("days", sql.Int, afterDays)
      .input("total", sql.Decimal(18, 2), afterTotal)
      .query(`UPDATE [dbo].[AccTravelBooking] SET
                IsContinuation=@cont, PerDiemDays=@days, PerDiemTotal=@total,
                UpdatedAt=SYSDATETIME()
              WHERE RequestId=@rid;
              UPDATE [dbo].[AccRequest] SET
                TotalAmount=@total, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid`);
  }

  const causeLabel =
    cause.kind === "cancelled" ? "ถูกยกเลิก"
    : cause.kind === "rejected" ? "ไม่ได้รับอนุมัติ"
    // "host_redated" (AP-17 package E): the cause is the GUEST whose dates were
    // rewritten to follow its room-share host — see `RecomputeCause`'s own
    // docblock for why the guest and not the host. Like "submitted" the cause
    // is never dead here (only a live guest is re-dated), so the "dead itself"
    // branch below is unreachable for this kind too.
    : cause.kind === "host_redated" ? "เปลี่ยนวันเดินทางตามคำขอที่พักห้องร่วม"
    // "submitted": the cause here is never dead (see rewriteSubmitAffectedTrips'
    // own doc comment for why), so the "dead itself" branch below — which reads
    // as if `cause` itself died — is unreachable for this kind; this label only
    // ever appears in the writable/Completed/no-dates branches, all of which
    // read correctly with "a new request was filed" as the reason.
    : "ถูกยื่นคำขอเพิ่ม";
  const causeNo = cause.requestNo ?? `#${cause.requestId}`;
  const figures = `(${beforeDays} วัน / ${beforeTotal.toFixed(2)})`;

  // `writable` can be false for three different reasons, and only one of them
  // is "accounting already signed this" — a status-blind note lied about the
  // other two, including on the cause's own row: continuationFlags reports a
  // dead trip's own flag as false, so whenever the dying request was itself
  // stored with IsContinuation=true — the ordinary case — it re-enters this
  // loop and, before this fix, got told it had "already passed accounting"
  // when what actually happened is that it died.
  let note: string;
  if (writable) {
    note = `Per diem ${beforeDays} → ${afterDays} วัน (${beforeTotal.toFixed(2)} → ${afterTotal.toFixed(2)}) เพราะ ${causeNo} ${causeLabel}`;
  } else if (!departDate || !returnDate) {
    note = `${causeNo} ${causeLabel} แต่คำขอนี้ไม่มีวันที่เดินทางครบถ้วน — ไม่ได้แก้ยอด ${figures}`;
  } else if (status === "Completed") {
    note = `${causeNo} ${causeLabel} แต่คำขอนี้ผ่านบัญชีแล้ว — ไม่ได้แก้ยอด ${figures}`;
  } else {
    // Dead itself (Cancelled/Rejected) — including the self-referencing case
    // where `requestId === cause.requestId`. Any future terminal status
    // `perDiemWritable` doesn't recognise falls in here too, named rather
    // than guessed at, so the sentence stays true even for a status this
    // file has never heard of.
    const deathLabel =
      status === "Cancelled" ? "คำขอนี้เองก็ถูกยกเลิกเช่นกัน"
      : status === "Rejected" ? "คำขอนี้เองก็ไม่ได้รับอนุมัติเช่นกัน"
      : `คำขอนี้เองมีสถานะ ${status}`;
    note = `${causeNo} ${causeLabel} — ${deathLabel} จึงไม่ได้แก้ยอด ${figures}`;
  }

  // AuthorId NULL, deliberately: nobody did this. A cancellation elsewhere
  // caused it, and `causedByRequestId` in the metadata is who to look at.
  await tx.request()
    .input("rid", sql.Int, requestId)
    .input("note", sql.NVarChar, note)
    .input("meta", sql.NVarChar, JSON.stringify({
      before: { days: beforeDays, total: beforeTotal },
      after: { days: afterDays, total: afterTotal },
      causedByRequestId: cause.requestId,
      causedByRequestNo: cause.requestNo,
      cause: cause.kind,
      locked: !writable,
      // Which rate priced the recomputed figure. A per-diem total that moved
      // because a country rate applies is a different event from one that
      // moved because a day was given back, and without this the two are
      // indistinguishable in the timeline — which is the only place anybody
      // reconciling a changed payment will look.
      rateSource,
      rateCountry,
    }))
    .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
            VALUES (@rid, NULL, 'perdiem_recalculated', @note, @meta)`);
}

/**
 * Full row data for the outside trips the chain now reaches, keyed by id.
 *
 * `loadRequesterTrips` only carries what the chain needs to order trips and
 * skip dead ones — it does not carry `Status`, `PerDiemDays`, `PerDiemTotal`,
 * `IsContinuation`, `EmployeeId`, `CountryCode`, `StaffId`,
 * `NeedsRoomBooking` or `IsRoomShareGuest`, all of which `rewritePerDiemRow`
 * needs. This is scoped to exactly the ids that could have moved
 * (`recomputeGroupPerDiem`'s `alsoAffected`), never to every trip on the
 * requester's calendar, so a trip nothing touched is never locked by this
 * transaction.
 */
async function loadOutsideDetailRows(
  tx: AccTx,
  requestIds: readonly number[],
): Promise<Record<string, unknown>[]> {
  if (requestIds.length === 0) return [];

  const req = tx.request();
  const params: string[] = [];
  requestIds.forEach((id, i) => {
    req.input(`oid${i}`, sql.Int, id);
    params.push(`@oid${i}`);
  });

  const res = await req.query(`SELECT ${PERDIEM_ROW_COLUMNS}
            FROM [dbo].[AccTravelBooking] t
            INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
           WHERE t.RequestId IN (${params.join(", ")})`);

  return res.recordset as Record<string, unknown>[];
}

/**
 * Rewrites every trip in `candidateIds` whose freshly computed continuation
 * flag disagrees with what is stored — the **submit-time** counterpart to
 * `recomputeGroupPerDiem` below, added 2026-09-22 (I1).
 *
 * `submitTravelBookingGroup` feeds `continuationFlags` the requester's WHOLE
 * calendar — its own tabs plus every other live trip — but until this existed
 * it only ever wrote its own tabs back. An existing trip whose predecessor
 * changed because of a newly filed one was never rewritten, so a shared
 * boundary day could be paid on both: file B (24–26) first, then A (20–24) —
 * `findDateOverlap` allows it, the chain correctly says B is now a
 * continuation, and without this, B keeps its original, now-wrong figure.
 * Filed in the other order the same pair paid correctly, so the bug was
 * order-dependent — unacceptable once CLAUDE.md states the calendar-wide rule
 * unqualified.
 *
 * Reuses `rewritePerDiemRow` and its `perDiemWritable` gate rather than a
 * second recompute: a candidate whose flag did not actually change costs
 * nothing (its own early return), and one already past accounting still gets
 * its `locked: true` audit row instead of being silently rewritten or
 * silently skipped — exactly `recomputeGroupPerDiem`'s own guarantee.
 *
 * **`candidateIds` is deliberately UNNARROWED, unlike `recomputeGroupPerDiem`'s
 * own `alsoAffected` below — do not "fix" this to match it (N9).**
 * `recomputeGroupPerDiem` only considers outside trips departing on or after
 * the CAUSE's own depart date, because a cancellation can only give a day
 * back to something that comes AFTER it in the chain. A newly filed tab has
 * no such direction: it can land BEFORE an existing trip on the calendar just
 * as easily as after it — that is I1's own headline case (B 24–26 already
 * stored, A 20–24 filed later, sitting chronologically BEFORE B). Narrowing
 * this call by date the same way would silently drop exactly the case I1
 * exists to fix. The caller (`submitTravelBookingGroup`) already hands this
 * the requester's whole live calendar via `liveOthers`, so there is nothing
 * further to narrow here — the cost is one extra `SELECT` per submit over the
 * requester's live-trip count, not a lock held any longer than a genuinely
 * changed row's own write.
 *
 * **Every candidate here must already be alive** (Cancelled/Rejected trips
 * are not eligible predecessors and must not have been included by the
 * caller) — which is also why `rewritePerDiemRow`'s "dead itself" branch,
 * written for a *cancelled or rejected* cause, is unreachable through this
 * path: nothing this function is ever asked to touch is itself dead.
 *
 * `causeFor(requestId)` resolves, for each row that actually needs rewriting,
 * which newly filed trip is responsible — computed by the caller from the
 * same chain it already built (`continuationPredecessors`), because that
 * identity depends on data (the submission's own tabs) only the caller has.
 * Returning `null` skips that one row's rewrite entirely, so a caller must
 * only omit a cause it is certain does not apply — a fallback to "this
 * submission" in general, rather than the true specific predecessor, is the
 * caller's call to make, not this function's.
 */
export async function rewriteSubmitAffectedTrips(
  tx: AccTx,
  candidateIds: readonly number[],
  nowFlags: ReadonlyMap<number, boolean>,
  causeFor: (requestId: number) => RecomputeCause | null,
): Promise<void> {
  if (candidateIds.length === 0) return;

  const rows = await loadOutsideDetailRows(tx, candidateIds);

  // Loaded once, only if some rewritten row turns out foreign — same
  // closure-cached shape `recomputeGroupPerDiem` uses below, for the same
  // reason: most submissions touch no foreign trip at all, and this module's
  // own test file runs with no database.
  let countryRates: PerDiemCountryRate[] | null = null;
  const loadRates = async (): Promise<PerDiemCountryRate[]> => {
    if (countryRates === null) countryRates = await listPerDiemCountryRates();
    return countryRates;
  };

  for (const x of rows) {
    const requestId = x.RequestId as number;
    const nowContinuation = nowFlags.get(requestId) ?? false;
    // Cheapest check first, and it also means a row whose flag genuinely did
    // not change never asks the caller to resolve a cause for it at all —
    // `rewritePerDiemRow` would no-op on this same comparison regardless, but
    // skipping it here avoids a pointless `causeFor` call.
    if (!!x.IsContinuation === nowContinuation) continue;
    const cause = causeFor(requestId);
    if (!cause) continue;
    await rewritePerDiemRow(tx, x, nowContinuation, cause, loadRates);
  }
}

/**
 * Recompute per diem for a booking group **and** every live trip elsewhere on
 * the same requester's calendar whose continuation position the cancellation
 * could have moved.
 *
 * A cancelled or rejected trip stops absorbing the day its successor dropped as
 * a duplicate — see `continuation-chain.ts`. Since the continuation chain now
 * spans a requester's whole calendar rather than one booking group
 * (2026-09-21), a trip in a *different* group, filed weeks apart, can also
 * gain or lose its predecessor here — so this widens past the group's own
 * `WHERE t.GroupKey = @gk` rows to every live AP-17 request of the same
 * requester departing on or after the cancelled trip's own depart date. See
 * `docs/superpowers/specs/2026-09-21-ap17-b-per-diem-rules.md` §3, "This makes
 * `recomputeGroupPerDiem` under-scoped."
 *
 * **Runs inside the caller's transaction.** A cancel that commits while this
 * fails leaves the group inconsistent in exactly the way it exists to prevent.
 *
 * **A `Completed` trip is never rewritten.** Accounting has signed the figure;
 * a predecessor cancelled afterwards is a thing for a person to decide. It still
 * gets a log row, with `before` equal to `after` — that is the case somebody
 * most needs to find later, and a silent skip leaves nothing to find.
 */
export interface RecomputeGroupOptions {
  /**
   * Rows whose own pricing INPUTS changed, and which must therefore be
   * repriced even though their continuation flag did not move — see
   * `rewritePerDiemRow`'s `forceReprice`. Empty or absent is today's
   * behaviour exactly, which is what every caller before AP-17 package E
   * wants: a cancellation moves a figure only by moving a chain position.
   *
   * The one caller that supplies it is the room-share date cascade, naming
   * the single guest whose depart/return it just rewrote.
   */
  repriceRequestIds?: readonly number[];
  /**
   * Overrides the "only a trip departing on or after the cause's own depart
   * date could have moved" narrowing applied to the requester's OUTSIDE trips.
   *
   * That narrowing is sound for a cancellation, which can only give a day back
   * to something later in the chain. A **re-date** is not directional: a guest
   * moved from 25–30 back to 20–24 changes the position of trips sitting
   * between the old span and the new one, and those are all EARLIER than the
   * row's current depart date — so the default lookup would silently drop
   * exactly the trips the move affected. The date cascade passes the earlier of
   * the guest's old and new depart dates.
   *
   * `null` or absent keeps the default (the cause's own depart date, read out
   * of the group).
   */
  affectedFromDate?: string | null;
}

export async function recomputeGroupPerDiem(
  tx: AccTx,
  groupKey: string,
  cause: RecomputeCause,
  options?: RecomputeGroupOptions,
): Promise<void> {
  const forced = options?.repriceRequestIds ?? [];
  const rows = await tx.request()
    .input("gk", sql.NVarChar(40), groupKey)
    // See `PERDIEM_ROW_COLUMNS`'s own doc comment above for what each of
    // r.CountryCode / r.StaffId / t.NeedsRoomBooking costs if it is dropped —
    // this query and `loadOutsideDetailRows`'s both build off that one list so
    // there is exactly one place either could be dropped from.
    .query(`SELECT t.SortOrder, ${PERDIEM_ROW_COLUMNS}
              FROM [dbo].[AccTravelBooking] t
              INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
             WHERE t.GroupKey = @gk`);

  const raw = rows.recordset as Record<string, unknown>[];

  const trips: ChainTrip[] = raw.map((x) => ({
    requestId: x.RequestId as number,
    sortOrder: (x.SortOrder as number) ?? 0,
    departDate: x.DepartDate ? toYmd(x.DepartDate as Date) : null,
    returnDate: x.ReturnDate ? toYmd(x.ReturnDate as Date) : null,
    // The cause's own row is already updated to its new status by the caller's
    // UPDATE, which ran earlier in this same transaction — so it reads as dead
    // here without being special-cased.
    alive: (x.Status as string) !== "Cancelled" && (x.Status as string) !== "Rejected",
  }));

  // **The chain now spans the requester's calendar, not this group.** Cancelling
  // a trip here can give a day back to a trip in a group filed weeks ago, and
  // before 2026-09-21 nothing recomputed that one — a silently wrong payment.
  //
  // Read on the SAME transaction the caller holds, so the rows this sees are
  // the rows the cancellation just wrote (the cause's own status included).
  const requesterId = raw.length > 0
    ? {
        staffId: (raw[0].StaffId as number) ?? null,
        employeeId: (raw[0].EmployeeId as string) ?? null,
      }
    : { staffId: null, employeeId: null };

  const groupIds = trips.map((t) => t.requestId);
  const outside = await loadRequesterTrips(tx, {
    staffId: requesterId.staffId,
    employeeId: requesterId.employeeId,
    excludeRequestIds: groupIds,
  });

  const chainInput: ChainTrip[] = trips.concat(
    outside
      .filter((o) => o.departDate && o.returnDate)
      .map((o) => ({
        requestId: o.requestId,
        sortOrder: o.sortOrder,
        departDate: o.departDate,
        returnDate: o.returnDate,
        alive: o.alive,
      })),
  );

  const flags = continuationFlags(chainInput);

  /**
   * The country rates, loaded once and **only if some row in this group or the
   * outside trips names a country other than TH**.
   *
   * That condition is not an optimisation. `perdiem-recompute.test.ts`'s
   * preamble records that it runs with no database: no fixture row carries an
   * `EmployeeId`, so `getAllowanceLog`'s HR read is never reached, and no
   * fixture `RequestId` reaches 900000, so `getPerDiemEmployeeLog`'s UAT
   * per-diem read (`uatByRecordId`) is never issued either. Loading rates
   * unconditionally would break that and force the test to grow a second stub
   * for a list that, on every domestic trip, cannot change the answer. Shared
   * by both loops below via closure, so a group with a foreign trip and an
   * outside trip in the same foreign country still fetches the rate list once.
   */
  let countryRates: PerDiemCountryRate[] | null = null;
  const loadRates = async (): Promise<PerDiemCountryRate[]> => {
    if (countryRates === null) countryRates = await listPerDiemCountryRates();
    return countryRates;
  };

  for (const x of raw) {
    const requestId = x.RequestId as number;
    const nowContinuation = flags.get(requestId) ?? false;
    await rewritePerDiemRow(
      tx, x, nowContinuation, cause, loadRates,
      forced.indexOf(requestId) !== -1,
    );
  }

  // Only a trip AFTER the cancelled one can have gained or lost its
  // predecessor. Recomputing the whole calendar would rewrite figures nothing
  // touched, and every extra row is a row inside this transaction's lock.
  // Dead outside trips are excluded here too — they will not be paid
  // regardless of what their flag reads, so there is nothing for them to
  // report.
  //
  // `affectedFromDate` overrides the anchor for the one caller whose change is
  // not directional — see `RecomputeGroupOptions`. It is read with `??` rather
  // than `||` so a caller cannot be silently ignored, and it is deliberately
  // NOT able to widen the arm to everything: an absent override still falls
  // back to the cause's own depart date, and a null one still switches the arm
  // off, exactly as before.
  const causeDepart =
    options?.affectedFromDate
    ?? (trips.find((t) => t.requestId === cause.requestId)?.departDate ?? null);
  const alsoAffected = causeDepart
    ? outside.filter((o) => o.alive && o.departDate && o.departDate >= causeDepart)
    : [];

  if (alsoAffected.length > 0) {
    const detailRows = await loadOutsideDetailRows(tx, alsoAffected.map((o) => o.requestId));
    for (const x of detailRows) {
      const requestId = x.RequestId as number;
      const nowContinuation = flags.get(requestId) ?? false;
      await rewritePerDiemRow(tx, x, nowContinuation, cause, loadRates);
    }
  }
}
