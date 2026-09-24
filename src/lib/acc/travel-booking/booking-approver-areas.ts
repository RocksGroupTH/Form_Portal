import { getAccPool, sql } from "@/lib/acc/pool";
import {
  BOOKING_AREAS,
  BOOKING_AREA_COLUMN,
  type BookingAreaKey,
} from "@/lib/acc/travel-booking/booking-areas";

/**
 * The pool half of `booking-areas.ts` — which AP-17 menus a person holds, read
 * off their own roster row.
 *
 * See that module for why these live in columns rather than in
 * `AccBookingApproverTab`, and for the measured reason this application stopped
 * keeping a second answer of its own.
 */

/**
 * Which of AP-17's three parts this person may open.
 *
 * **One read, not three**, and no join: the gate runs on every acting request
 * into the module, and all three columns sit on the row `canAccessBookingArea`
 * is already fetching. An email with no **active** row comes back empty, which
 * is the same refusal it always was — membership is still the outer gate and
 * these only narrow it.
 *
 * `IsActive = 1` is tested here rather than in a caller, so deactivating
 * somebody revokes all three immediately and reactivating restores exactly what
 * they had; the columns are never cleared by a deactivation.
 */
export async function resolveBookingAreasByEmail(
  email: string | null | undefined,
): Promise<BookingAreaKey[]> {
  if (!email) return [];
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(
      `SELECT TOP 1 ${BOOKING_AREAS.map((a) => BOOKING_AREA_COLUMN[a.key]).join(", ")}
         FROM [dbo].[AccBookingApprover]
        WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  const row = r.recordset[0] as Record<string, boolean> | undefined;
  if (!row) return [];
  return BOOKING_AREAS.filter((a) => !!row[BOOKING_AREA_COLUMN[a.key]]).map((a) => a.key);
}

/**
 * `ApproverId → areas`, for the settings grid — one read for the whole page.
 *
 * **A missing column degrades to "every area", the opposite direction from
 * `loadBookingTabsByApproverIds`.** That loader treats a missing table as no
 * grants because its rows hand out something new; these columns *narrow*
 * something the roster row already carries, and migration 124 wrote 1 into all
 * three for every row that existed. A database that has not had 124 applied
 * therefore behaves exactly as it did before 124 — everybody on the roster sees
 * everything — rather than locking the whole roster out of AP-17 at once.
 *
 * Any other failure rethrows, so the admin grid shows its error state instead
 * of rendering an unreadable list as every box ticked — the next save would
 * then write those ticks in as fact.
 */
export async function loadBookingAreasByApproverIds(
  approverIds: number[],
): Promise<Map<number, BookingAreaKey[]>> {
  const map = new Map<number, BookingAreaKey[]>();
  if (approverIds.length === 0) return map;

  const all = BOOKING_AREAS.map((a) => a.key);
  try {
    const pool = await getAccPool();
    const placeholders = approverIds.map((_, i) => `@id${i}`).join(", ");
    const req = pool.request();
    approverIds.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
    const r = await req.query(
      `SELECT Id, ${BOOKING_AREAS.map((a) => BOOKING_AREA_COLUMN[a.key]).join(", ")}
         FROM [dbo].[AccBookingApprover]
        WHERE Id IN (${placeholders})`,
    );
    for (const row of r.recordset as Array<Record<string, number | boolean>>) {
      map.set(
        Number(row.Id),
        BOOKING_AREAS.filter((a) => !!row[BOOKING_AREA_COLUMN[a.key]]).map((a) => a.key),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Msg 207, not 208: these are COLUMNS, so a database without 124 answers
    // "Invalid column name 'CanQueue'" rather than a missing object.
    if (msg.includes("Invalid column name") && msg.includes("CanQueue")) {
      console.error("[booking-approver-areas] migration 124 not applied — treating as all areas", err);
      for (const id of approverIds) map.set(id, all.slice());
      return map;
    }
    throw err;
  }

  // An id the query did not return has no roster row — a race with a delete,
  // since the caller read these ids from this same table. `[]` rather than
  // `all`: the grid saves what it renders, and every box ticked for a row that
  // does not exist is the one answer that could write a grant nobody asked for.
  // The missing-column arm above is the opposite case and returns before this.
  for (const id of approverIds) if (!map.has(id)) map.set(id, []);
  return map;
}
