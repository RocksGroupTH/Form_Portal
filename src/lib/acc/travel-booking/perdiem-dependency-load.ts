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
 * whole `GroupKey` groups in one round trip rather than one query per row: the
 * accounting queue needs every row's answer at once, and the sign-off needs one
 * row's answer computed at the moment of the call rather than trusted from the
 * client. Giving them one loader is what keeps the queue's warning and the
 * route's refusal from ever disagreeing about the same request.
 */

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/** Anything with `.request()` — a pool, or a caller's open transaction. */
type SqlRunner = { request: () => ReturnType<AccPool["request"]> };

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface GroupRow {
  RequestId: number;
  GroupKey: string;
  SortOrder: number | null;
  DepartDate: Date | null;
  ReturnDate: Date | null;
  RequestNo: string | null;
  Status: string;
}

/**
 * For each requested id, the trip its per-diem figure still hangs on, or null
 * when nothing can move it.
 *
 * One query, one round trip, whatever the size of the input: the ids are bound
 * individually (`@id0`, `@id1`, …) into an `IN` list — the shape
 * `listAccountQueue`'s `perDiemHistory` batch already uses — and that list only
 * selects the *group keys*; the outer query then pulls every sibling of those
 * groups, because a dependency is a *predecessor*, which by definition is not
 * one of the rows asked about.
 *
 * A trip with no `GroupKey` (a lone booking) is filtered out on both sides and
 * simply answers null — `perDiemDependency` returns null for an empty group
 * anyway, so the filter is an index-friendly shortcut rather than a rule of its
 * own. An id that is not an AP-17 request is absent from the map, and
 * `dependencyFor` below reads that as null too.
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
    SELECT t.RequestId, t.GroupKey, t.SortOrder, t.DepartDate, t.ReturnDate,
           r.RequestNo, r.Status
      FROM [dbo].[AccTravelBooking] t
      INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
     WHERE t.GroupKey IS NOT NULL
       AND t.GroupKey IN (
             SELECT g.GroupKey FROM [dbo].[AccTravelBooking] g
              WHERE g.RequestId IN (${placeholders.join(", ")}) AND g.GroupKey IS NOT NULL
           )
  `);

  const byGroup = new Map<string, DependencyTrip[]>();
  const groupOfRequest = new Map<number, string>();
  for (const row of res.recordset as GroupRow[]) {
    const trip: DependencyTrip = {
      requestId: row.RequestId,
      requestNo: row.RequestNo ?? null,
      sortOrder: row.SortOrder ?? 0,
      departDate: row.DepartDate ? toYmd(row.DepartDate) : null,
      returnDate: row.ReturnDate ? toYmd(row.ReturnDate) : null,
      status: row.Status,
    };
    const list = byGroup.get(row.GroupKey) ?? [];
    list.push(trip);
    byGroup.set(row.GroupKey, list);
    groupOfRequest.set(row.RequestId, row.GroupKey);
  }

  for (const id of requestIds) {
    const groupKey = groupOfRequest.get(id);
    if (!groupKey) {
      out.set(id, null);
      continue;
    }
    const group = byGroup.get(groupKey) ?? [];
    const target = group.find((t) => t.requestId === id);
    out.set(id, target ? perDiemDependency(target, group) : null);
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
