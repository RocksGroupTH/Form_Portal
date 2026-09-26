import { getAccPool, sql } from "@/lib/acc/pool";

/**
 * AP-4's Message settings-tab grant — `AccReimburseAccess.CanMessage`
 * (migration 166), read by email for `requireReimburseMessageAccess`.
 *
 * Deliberately its own file rather than a new export on `access-tabs.ts`,
 * which owns `AccReimburseAccessTab` — the `TabKey` child table this grant is
 * specifically NOT stored in. See `@/lib/acc/message-grant` for why.
 */

/**
 * Whether this email may open AP-4's Message tab, from their own **active**
 * `AccReimburseAccess` row.
 *
 * **A missing column degrades to `false`, never to `true`.** `CanMessage`
 * carries a `DEFAULT 0` and is new reach — nobody held it before migration
 * 166 — so a database that has not yet had 166 applied must behave exactly as
 * it did before, not open the tab to every AP-4 access-holder at once.
 */
export async function resolveReimburseAccessCanMessageByEmail(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  try {
    const pool = await getAccPool();
    const r = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(
        `SELECT TOP 1 CanMessage FROM [dbo].[AccReimburseAccess] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
      );
    return !!r.recordset[0]?.CanMessage;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Invalid column name") && msg.includes("CanMessage")) {
      console.error(
        "[reimburse-access-message-access] migration 166 not applied — treating as not granted",
        err,
      );
      return false;
    }
    throw err;
  }
}
