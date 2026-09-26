import { getAccPool, sql } from "@/lib/acc/pool";

/**
 * AP-17's Message settings-tab grant — `AccBookingApprover.CanMessage`
 * (migration 166), read by email for `requireBookingMessageAccess`.
 *
 * Deliberately its own file rather than a new export on
 * `booking-approver-tabs.ts` (which owns `AccBookingApproverTab`) or
 * `booking-approver-areas.ts` (which owns `CanQueue` / `CanAccount` /
 * `CanReport`). This grant is neither: it is not a `TabKey` row — see
 * `@/lib/acc/message-grant` for why — and it is not one of the three menu
 * areas, which narrow something the roster already implied and so are allowed
 * to fail open on a missing column. `CanMessage` must not.
 */

/**
 * Whether this email may open AP-17's Message tab, from their own **active**
 * `AccBookingApprover` row.
 *
 * **A missing column degrades to `false`.** `CanMessage` carries a
 * `DEFAULT 0` and is new reach — unlike the three menu columns beside it on
 * the same table, which migration 124 defaulted to 1 because being on this
 * roster had always opened all three. A database that has not yet had
 * migration 166 applied must behave exactly as it did before, not open the tab
 * to every booking approver at once.
 */
export async function resolveBookingApproverCanMessageByEmail(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  try {
    const pool = await getAccPool();
    const r = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(
        `SELECT TOP 1 CanMessage FROM [dbo].[AccBookingApprover] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
      );
    return !!r.recordset[0]?.CanMessage;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Invalid column name") && msg.includes("CanMessage")) {
      console.error(
        "[booking-approver-message-access] migration 166 not applied — treating as not granted",
        err,
      );
      return false;
    }
    throw err;
  }
}
