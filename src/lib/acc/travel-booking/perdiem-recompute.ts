import { getAccPool, sql } from "@/lib/acc/pool";
import { continuationFlags, type ChainTrip } from "@/lib/acc/travel-booking/continuation-chain";
import { computePerDiem } from "@/lib/acc/travel-booking/perdiem";
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
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
    .query(`SELECT t.RequestId, t.SortOrder, t.DepartDate, t.ReturnDate,
                   t.IsContinuation, t.PerDiemDays, t.PerDiemTotal,
                   r.Status, r.EmployeeId
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

    if (writable) {
      // `getAllowanceLog` from `./allowance-log` — the same reader
      // `submitTravelBookingGroup` uses at request-service.ts:1170. It takes its
      // own pool rather than this transaction, which is fine: it only reads, and
      // the allowance history is not something this transaction is changing.
      const employeeId = x.EmployeeId as string | null;
      const log = employeeId ? await getAllowanceLog(employeeId) : [];
      const computed = computePerDiem(departDate!, returnDate!, nowContinuation, log);
      afterDays = computed.days;
      afterTotal = computed.total;

      await tx.request()
        .input("rid", sql.Int, requestId)
        .input("cont", sql.Bit, nowContinuation ? 1 : 0)
        .input("days", sql.Int, afterDays)
        .input("total", sql.Decimal(18, 2), afterTotal)
        .query(`UPDATE [dbo].[AccTravelBooking] SET
                  IsContinuation=@cont, PerDiemDays=@days, PerDiemTotal=@total,
                  UpdatedAt=SYSDATETIME()
                WHERE RequestId=@rid`);
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
      }))
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
              VALUES (@rid, NULL, 'perdiem_recalculated', @note, @meta)`);
  }
}
