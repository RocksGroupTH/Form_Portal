import { getAccPool, sql } from "@/lib/acc/pool";

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/** Anything with `.request()` — a pool, or a caller's open transaction. */
type SqlRunner = { request: () => ReturnType<AccPool["request"]> };

/**
 * Rewrite every booking row's baht equivalent for one AP-17 request.
 *
 * `AccTravelBookingDetail.TotalAmountBaht` (migration 136) is a stored
 * derivation of `TotalAmount × AccRequest.ExchangeRate`, and a stored derivation
 * is only safe while everything that can move its inputs moves it too. This is
 * the one statement that does, so the two writers of `AccRequest.ExchangeRate`
 * cannot disagree about what a booking cost:
 *
 *   1. `saveBookingDetail` (`admin-service.ts`), on every row save
 *   2. `applyRateOverride` (`../rate-override.ts`), when accounting corrects the
 *      rate at sign-off
 *
 * **A third writer of that rate must call this too**, inside its own
 * transaction, or the column silently starts describing a rate the header no
 * longer holds.
 *
 * ── Every row, not the one being saved ──
 *
 * One rate is recorded per request, on the header, and `saveBookingDetail`
 * re-fetches it on each row save. So rows entered on different days are all
 * converted at whatever rate landed last, and rewriting only the row in hand
 * would leave its siblings quoting a rate that is no longer anywhere. The whole
 * request is rewritten each time for that reason; there is one rate, so there is
 * one recompute.
 *
 * ── Baht rows are written too, and that is the point ──
 *
 * A null `rate` means the request is in baht, and the baht figure is then
 * `TotalAmount` itself. Writing it rather than leaving NULL is what lets every
 * reader sum this column with no currency test at all — which is what makes
 * double conversion, the one defect this shape can produce, unexpressible
 * rather than a rule three call sites have to remember.
 *
 * A row with no `TotalAmount` yet gets NULL either way: NULL says "no figure",
 * where 0 would claim the booking was free.
 *
 * Must run **inside** the caller's transaction, in the same one as the header
 * write it follows. Split across two commits there is a window in which the rate
 * and the figures derived from it disagree, on an accounting screen.
 */
export async function recomputeBookingBaht(
  tx: SqlRunner,
  requestId: number,
  rate: number | null,
): Promise<void> {
  await tx
    .request()
    .input("rid", sql.Int, requestId)
    .input("rate", sql.Decimal(18, 6), rate)
    .query(`UPDATE bd
               SET bd.[TotalAmountBaht] =
                     CASE WHEN @rate IS NULL THEN bd.[TotalAmount]
                          ELSE ROUND(bd.[TotalAmount] * @rate, 2) END
              FROM [dbo].[AccTravelBookingDetail] bd
              INNER JOIN [dbo].[AccTravelBooking] t ON t.Id = bd.[TravelBookingId]
             WHERE t.[RequestId] = @rid`);
}
