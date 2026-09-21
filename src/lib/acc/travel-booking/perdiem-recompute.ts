import { getAccPool, sql } from "@/lib/acc/pool";
import { continuationFlags, type ChainTrip } from "@/lib/acc/travel-booking/continuation-chain";
import { computePerDiem } from "@/lib/acc/travel-booking/perdiem";
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

/** Which cancellation/rejection caused a recompute, and its running number for the note. */
type RecomputeCause = { requestId: number; requestNo: string | null; kind: "cancelled" | "rejected" };

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Rewrite one trip's per diem for one continuation-flag change — the body
 * shared by the group's own rows and the outside rows the chain now reaches
 * (`recomputeGroupPerDiem` below), so the two paths can never drift apart.
 *
 * `x` carries the same column shape either way: `RequestId`, `Status`,
 * `EmployeeId`, `CountryCode`, `StaffId`, `DepartDate`, `ReturnDate`,
 * `IsContinuation`, `PerDiemDays`, `PerDiemTotal`, `NeedsRoomBooking` — one
 * from the `GroupKey` SELECT, the other from `loadOutsideDetailRows` below.
 *
 * No-op (no UPDATE, no audit row) when the flag has not changed — that row was
 * never touched by this cancellation and must not appear in the trail at all.
 */
async function rewritePerDiemRow(
  tx: AccTx,
  x: Record<string, unknown>,
  nowContinuation: boolean,
  cause: RecomputeCause,
  loadRates: () => Promise<PerDiemCountryRate[]>,
): Promise<void> {
  const requestId = x.RequestId as number;
  const status = x.Status as string;
  const wasContinuation = !!x.IsContinuation;
  if (wasContinuation === nowContinuation) return;

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
    const computed = computePerDiem(departDate!, returnDate!, nowContinuation, resolved.log, {
      roomBooked: !!x.NeedsRoomBooking,
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

  const causeLabel = cause.kind === "cancelled" ? "ถูกยกเลิก" : "ไม่ได้รับอนุมัติ";
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
 * `IsContinuation`, `EmployeeId`, `CountryCode`, `StaffId` or
 * `NeedsRoomBooking`, all of which `rewritePerDiemRow` needs. This is scoped
 * to exactly the ids that could have moved (`recomputeGroupPerDiem`'s
 * `alsoAffected`), never to every trip on the requester's calendar, so a trip
 * nothing touched is never locked by this transaction.
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

  const res = await req.query(`SELECT t.RequestId, t.DepartDate, t.ReturnDate,
                 t.IsContinuation, t.PerDiemDays, t.PerDiemTotal, t.NeedsRoomBooking,
                 r.Status, r.EmployeeId, r.CountryCode, r.StaffId
            FROM [dbo].[AccTravelBooking] t
            INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
           WHERE t.RequestId IN (${params.join(", ")})`);

  return res.recordset as Record<string, unknown>[];
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
export async function recomputeGroupPerDiem(
  tx: AccTx,
  groupKey: string,
  cause: RecomputeCause,
): Promise<void> {
  const rows = await tx.request()
    .input("gk", sql.NVarChar(40), groupKey)
    // r.CountryCode is load-bearing. Without it perDiemLogFor is handed null,
    // and cancelling any trip in a group re-prices its surviving siblings at the
    // employee's Thai allowance — writing that to AccTravelBooking.PerDiemTotal
    // AND AccRequest.TotalAmount inside the cancelling transaction, with an
    // activity row that records the figure moved and not why. A London trip
    // would silently revert to a domestic rate and nothing on any screen would
    // contradict it. Deleting this column from the SELECT fails no typecheck:
    // the value simply arrives undefined.
    //
    // r.StaffId is load-bearing for exactly the same reason and in exactly the
    // same way. It is how a UAT tester's own per-diem rate is found; without it
    // the lookup finds nothing and every UAT trip in the group is re-priced at
    // the tester's REAL HR allowance, here, inside the same transaction.
    .query(`SELECT t.RequestId, t.SortOrder, t.DepartDate, t.ReturnDate,
                   t.IsContinuation, t.PerDiemDays, t.PerDiemTotal, t.NeedsRoomBooking,
                   r.Status, r.EmployeeId, r.CountryCode, r.StaffId
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
    await rewritePerDiemRow(tx, x, nowContinuation, cause, loadRates);
  }

  // Only a trip AFTER the cancelled one can have gained or lost its
  // predecessor. Recomputing the whole calendar would rewrite figures nothing
  // touched, and every extra row is a row inside this transaction's lock.
  // Dead outside trips are excluded here too — they will not be paid
  // regardless of what their flag reads, so there is nothing for them to
  // report.
  const causeDepart = trips.find((t) => t.requestId === cause.requestId)?.departDate ?? null;
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
