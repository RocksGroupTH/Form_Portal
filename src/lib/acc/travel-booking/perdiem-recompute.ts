import { getAccPool, sql } from "@/lib/acc/pool";
import { continuationFlags, type ChainTrip } from "@/lib/acc/travel-booking/continuation-chain";
import { computePerDiem } from "@/lib/acc/travel-booking/perdiem";
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
import { perDiemLogFor, type PerDiemCountryRate } from "@/lib/acc/travel-booking/perdiem-country";
import { listPerDiemCountryRates } from "@/lib/acc/travel-booking/perdiem-source";
import { perDiemWritable } from "@/lib/acc/travel-booking/perdiem-window";

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/**
 * The shape `reimburse/request-service.ts:74` uses — a thing with `.request()`,
 * not `admin-service.ts:109`'s `ReturnType<AccPool["transaction"]>` (the
 * transaction object itself). Declared locally so this module has no
 * dependency on either caller's private type.
 */
type AccTx = { request: () => ReturnType<AccPool["request"]> };

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Recompute a booking group's per diem after one of its trips dies.
 *
 * A cancelled or rejected trip stops absorbing the day its successor dropped as
 * a duplicate — see `continuation-chain.ts`. Everything below is bookkeeping
 * around that one idea.
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
  cause: { requestId: number; requestNo: string | null; kind: "cancelled" | "rejected" },
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
    .query(`SELECT t.RequestId, t.SortOrder, t.DepartDate, t.ReturnDate,
                   t.IsContinuation, t.PerDiemDays, t.PerDiemTotal,
                   r.Status, r.EmployeeId, r.CountryCode
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

  const flags = continuationFlags(trips);

  /**
   * The country rates, loaded once and **only if some row in this group names a
   * country other than TH**.
   *
   * That condition is not an optimisation. `perdiem-recompute.test.ts`'s
   * preamble records that it runs with no database because no fixture row
   * carries an `EmployeeId`, so `getAllowanceLog` — the only real network call
   * this module can make — is never reached. Loading rates unconditionally would
   * break that and force the test to grow a second stub for a list that, on
   * every domestic group, cannot change the answer.
   */
  let countryRates: PerDiemCountryRate[] | null = null;
  const loadRates = async (): Promise<PerDiemCountryRate[]> => {
    if (countryRates === null) countryRates = await listPerDiemCountryRates();
    return countryRates;
  };

  for (const x of raw) {
    const requestId = x.RequestId as number;
    const status = x.Status as string;
    const wasContinuation = !!x.IsContinuation;
    const nowContinuation = flags.get(requestId) ?? false;
    if (wasContinuation === nowContinuation) continue;

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
      // `getAllowanceLog` from `./allowance-log` — the same reader
      // `submitTravelBookingGroup` uses at request-service.ts:1170. It takes its
      // own pool rather than this transaction, which is fine: it only reads, and
      // the allowance history is not something this transaction is changing.
      const employeeId = x.EmployeeId as string | null;
      const log = employeeId ? await getAllowanceLog(employeeId) : [];
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
      const computed = computePerDiem(departDate!, returnDate!, nowContinuation, resolved.log);
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
}
