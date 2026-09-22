import { getAccPool, sql } from "@/lib/acc/pool";
import {
  perDiemDependency,
  type DependencyTrip,
  type PerDiemDependency,
} from "@/lib/acc/travel-booking/perdiem-dependency";

/**
 * The database half of `perdiem-dependency.ts` — it reads, that file decides.
 *
 * Both callers ask the same question for a *set* of requests, so this loads
 * a requester's whole calendar in one round trip rather than one query per
 * row: the accounting queue needs every row's answer at once, and the
 * sign-off needs one row's answer computed at the moment of the call rather
 * than trusted from the client. Giving them one loader is what keeps the
 * queue's warning and the route's refusal from ever disagreeing about the
 * same request.
 *
 * **Requester-scoped since 2026-09-22, not `GroupKey`-scoped.** The
 * continuation chain and the cancellation recompute both widened to span a
 * requester's whole live AP-17 calendar (`continuation-chain.ts`,
 * `perdiem-recompute.ts`) — a trip filed in one group can now continue a
 * trip filed in a completely different one, weeks earlier. Resolving a
 * predecessor by `GroupKey` alone stopped seeing that: the sign-off would
 * report "no predecessor" for a trip whose figure genuinely still depended
 * on one in another group, and `approveByAccount`'s own in-transaction
 * re-check agreed with the wrong answer, because it asks this same loader.
 * See `docs/superpowers/specs/2026-09-21-ap17-b-per-diem-rules.md` §3 and
 * CLAUDE.md's AP-17 section, "the gate and the recompute window compose."
 *
 * The predicate matching a candidate trip to "the same requester" is
 * `requester-trips.ts`'s own — `r.FormCode = 'AP-17'`, `r.Status <> 'Draft'`,
 * StaffId OR EmployeeId, each arm guarded `IS NOT NULL` so a null on one
 * side cannot match a null row on the other — copied rather than imported:
 * that module returns a different row shape (no `Status`, no `GroupKey`)
 * built for a different pair of callers, and this one needs its own columns.
 * Matching the predicate is what has to hold, not sharing the function.
 */

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/** Anything with `.request()` — a pool, or a caller's open transaction. */
type SqlRunner = { request: () => ReturnType<AccPool["request"]> };

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface RequesterTripRow {
  /** Which of the requested ids this row is a candidate predecessor/self for. */
  TargetRequestId: number;
  RequestId: number;
  /** Still selected so a caller reading the raw recordset can still find it — unused below. */
  GroupKey: string | null;
  SortOrder: number | null;
  DepartDate: Date | null;
  ReturnDate: Date | null;
  RequestNo: string | null;
  Status: string;
}

/**
 * Orders a requester's candidate trips the same way `continuationFlags`
 * does — depart date, `SortOrder` as tiebreak — and bakes that order into
 * each trip's own `sortOrder` field as a plain sequential index.
 *
 * `perDiemDependency` sorts its `group` argument by `sortOrder` and walks
 * backward from the target by array index; it has no idea what a depart date
 * is. Rather than teach the pure module a second ordering rule, the loader
 * resolves the real order once, here, and hands it a `sortOrder` that
 * already encodes that order — the pure module's own internal sort then
 * reproduces it as a no-op. Raw `AccTravelBooking.SortOrder` only ever meant
 * "fill order within one group" (`continuation-chain.ts`'s own docblock),
 * which is exactly why it cannot be trusted across groups: two trips filed
 * weeks apart in different groups can each be `SortOrder = 0`.
 */
function chainOrder(trips: readonly DependencyTrip[]): DependencyTrip[] {
  return trips
    .slice()
    .sort((a, b) => {
      const ad = a.departDate ?? "";
      const bd = b.departDate ?? "";
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    })
    .map((t, i) => ({ ...t, sortOrder: i }));
}

/**
 * For each requested id, the trip its per-diem figure still hangs on, or null
 * when nothing can move it.
 *
 * One query, one round trip, whatever the size of the input: the ids are
 * bound individually (`@id0`, `@id1`, …) into an `IN` list — the shape
 * `listAccountQueue`'s `perDiemHistory` batch already uses. A derived table
 * resolves each requested id's own `StaffId`/`EmployeeId` first, then the
 * outer joins pull every one of *that requester's* live, non-draft AP-17
 * trips — never only the ones sharing its `GroupKey` — because a dependency
 * is a *predecessor*, which by definition is not one of the rows asked
 * about, and the predecessor `continuation-chain.ts` now finds may sit in a
 * different group entirely.
 *
 * A requested id that matches nothing (no `AccRequest` row, or one with
 * neither `StaffId` nor `EmployeeId` set, or no `AccTravelBooking` row of its
 * own) simply answers null — `perDiemDependency` returns null for a target
 * absent from its own candidate list, so the join is a filter rather than a
 * rule of its own.
 */
export async function loadPerDiemDependencies(
  runner: SqlRunner,
  requestIds: readonly number[],
): Promise<Map<number, PerDiemDependency | null>> {
  const out = new Map<number, PerDiemDependency | null>();
  if (requestIds.length === 0) return out;

  const req = runner.request();
  const placeholders = requestIds.map((id, i) => {
    req.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });

  const res = await req.query(`
    SELECT tg.Id AS TargetRequestId,
           t.RequestId, t.GroupKey, t.SortOrder, t.DepartDate, t.ReturnDate,
           r.RequestNo, r.Status
      FROM (
            SELECT Id, StaffId, EmployeeId
              FROM [dbo].[AccRequest]
             WHERE Id IN (${placeholders.join(", ")})
           ) tg
      INNER JOIN [dbo].[AccRequest] r
              ON r.FormCode = 'AP-17'
             AND r.Status <> 'Draft'
             AND (
               (tg.StaffId IS NOT NULL AND r.StaffId = tg.StaffId)
               OR (tg.EmployeeId IS NOT NULL AND r.EmployeeId = tg.EmployeeId)
             )
      INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
  `);

  const byTarget = new Map<number, DependencyTrip[]>();
  for (const row of res.recordset as RequesterTripRow[]) {
    const trip: DependencyTrip = {
      requestId: row.RequestId,
      requestNo: row.RequestNo ?? null,
      sortOrder: row.SortOrder ?? 0,
      departDate: row.DepartDate ? toYmd(row.DepartDate) : null,
      returnDate: row.ReturnDate ? toYmd(row.ReturnDate) : null,
      status: row.Status,
    };
    const list = byTarget.get(row.TargetRequestId) ?? [];
    list.push(trip);
    byTarget.set(row.TargetRequestId, list);
  }

  for (const id of requestIds) {
    const candidates = byTarget.get(id);
    if (!candidates || candidates.length === 0) {
      out.set(id, null);
      continue;
    }
    // Depart-date order with SortOrder as tiebreak — see `chainOrder`. This
    // has to agree with `continuationFlags`'s own ordering or the gate can
    // block on one trip while the figure actually depends on another.
    const ordered = chainOrder(candidates);
    const target = ordered.find((t) => t.requestId === id);
    out.set(id, target ? perDiemDependency(target, ordered) : null);
  }
  return out;
}

/** The one-request case — the sign-off's, computed fresh from the database. */
export async function loadPerDiemDependency(
  runner: SqlRunner,
  requestId: number,
): Promise<PerDiemDependency | null> {
  const map = await loadPerDiemDependencies(runner, [requestId]);
  return map.get(requestId) ?? null;
}
