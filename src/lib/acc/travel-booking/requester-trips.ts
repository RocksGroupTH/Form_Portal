import { getAccPool, sql } from "@/lib/acc/pool";

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/**
 * Anything with `.request()` — a pool, or a caller's open transaction. Same
 * shape as `perdiem-dependency-load.ts`'s `SqlRunner` and
 * `perdiem-recompute.ts`'s `AccTx`: the cancellation recompute (a later task)
 * calls this loader from inside the transaction that claims the row, and
 * `mssql`'s `ConnectionPool` and `Transaction` both expose `.request()` with
 * the same signature, so a structural type admits either without importing
 * either class by name.
 */
type SqlRunner = { request: () => ReturnType<AccPool["request"]> };

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Every AP-17 trip on one person's calendar, for the rules that span requests.
 *
 * Shared by three callers that must agree: the submit's duplicate-date refusal
 * (`date-overlap.ts`), the submit's continuation flags, and the cancellation
 * recompute. Separate queries would drift, and a chain that disagreed with the
 * refusal would either double-pay a day or refuse a submit it then paid twice.
 *
 * **Matched on StaffId OR EmployeeId**, the two ways an AP-17 requester is
 * identified — `AccRequest.StaffId` is null for a requester with no active HR
 * row, and `EmployeeId` is the uniqueidentifier the booking form carries.
 * Either alone misses real trips.
 */
export interface RequesterTrip {
  requestId: number;
  requestNo: string | null;
  sortOrder: number;
  departDate: string | null;
  returnDate: string | null;
  /** False once Cancelled or Rejected — it will not be paid. */
  alive: boolean;
}

export async function loadRequesterTrips(
  pool: SqlRunner,
  input: {
    staffId: number | null;
    employeeId: string | null;
    /** The request(s) being submitted or recomputed — never their own neighbour. */
    excludeRequestIds: readonly number[];
  },
): Promise<RequesterTrip[]> {
  if (input.staffId == null && !input.employeeId) return [];

  const req = pool.request().input("staffId", sql.Int, input.staffId);
  req.input("employeeId", sql.UniqueIdentifier, input.employeeId);

  // Excluded ids are bound one parameter each — never interpolated, however
  // small and however internal the list looks.
  const params: string[] = [];
  input.excludeRequestIds.forEach((id, i) => {
    req.input(`ex${i}`, sql.Int, id);
    params.push(`@ex${i}`);
  });
  const exclude = params.length > 0 ? `AND r.Id NOT IN (${params.join(", ")})` : "";

  const res = await req.query(`
    SELECT t.RequestId, t.SortOrder, t.DepartDate, t.ReturnDate,
           r.RequestNo, r.Status
      FROM [dbo].[AccTravelBooking] t
      INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
     WHERE r.FormCode = 'AP-17'
       AND r.Status <> 'Draft'
       AND (
         (@staffId IS NOT NULL AND r.StaffId = @staffId)
         OR (@employeeId IS NOT NULL AND r.EmployeeId = @employeeId)
       )
       ${exclude}`);

  return (res.recordset as Record<string, unknown>[]).map((x) => ({
    requestId: x.RequestId as number,
    requestNo: (x.RequestNo as string) ?? null,
    sortOrder: (x.SortOrder as number) ?? 0,
    departDate: x.DepartDate ? toYmd(x.DepartDate as Date) : null,
    returnDate: x.ReturnDate ? toYmd(x.ReturnDate as Date) : null,
    alive: (x.Status as string) !== "Cancelled" && (x.Status as string) !== "Rejected",
  }));
}
