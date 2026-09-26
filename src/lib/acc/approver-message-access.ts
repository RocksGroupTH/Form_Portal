import { getAccPool, sql } from "@/lib/acc/pool";

/**
 * AP-1's Message settings-tab grant — `AccApprover.CanMessage` (migration
 * 166), read by email for `requireAccMessageAccess`.
 *
 * Deliberately its own file rather than a new export on
 * `approver-settings-tabs.ts`: that module owns `AccApproverSettingsTab`, the
 * `TabKey` child table this grant is specifically NOT stored in — see
 * `@/lib/acc/message-grant` for why. Keeping the two apart means a reader who
 * opens this file cannot mistake the column read here for a row in that table.
 */

/**
 * Whether this email may open AP-1's Message tab, from their own **active**
 * `AccApprover` row.
 *
 * **A missing column degrades to `false`, never to `true`.** Unlike AP-17's
 * `CanQueue` / `CanAccount` / `CanReport` — which narrow something the roster
 * already implied and so fail open — `CanMessage` is new reach with a
 * `DEFAULT 0`: nobody held it before migration 166, so a database that has not
 * yet had 166 applied must behave exactly as it did before, not open the tab to
 * every approver at once.
 */
export async function resolveApproverCanMessageByEmail(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  try {
    const pool = await getAccPool();
    const r = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(
        `SELECT TOP 1 CanMessage FROM [dbo].[AccApprover] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
      );
    return !!r.recordset[0]?.CanMessage;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Msg 207, not 208: this is a COLUMN, so a database without 166 answers
    // "Invalid column name 'CanMessage'" rather than a missing object.
    if (msg.includes("Invalid column name") && msg.includes("CanMessage")) {
      console.error(
        "[approver-message-access] migration 166 not applied — treating as not granted",
        err,
      );
      return false;
    }
    throw err;
  }
}
