import { getAccPool, sql } from "@/lib/adv/pool";

/**
 * AP-2's and AP-3's Message settings-tab grants — `AccAdvClrAccess.CanAdvanceMessage`
 * and `.CanClearMessage` (migration 166), read by email for
 * `requireAdvanceMessageAccess` / `requireClearMessageAccess`.
 *
 * **Two columns on ONE shared roster row**, exactly like
 * `advanceErpInterface` / `clearErpInterface`: `AccAdvClrAccess` (migration
 * 152) carries no `FormCode`, so a person is either form's message-tab holder
 * on their own row, and the two ticks are independent. Deliberately its own
 * file rather than a new export on `access-service.ts` (which owns
 * `AccAdvClrAccessTab`, the `TabKey` child table this grant is specifically
 * NOT stored in — see `@/lib/acc/message-grant` for why).
 */

type MessageColumn = "CanAdvanceMessage" | "CanClearMessage";

async function resolveCanMessageByEmail(
  email: string | null | undefined,
  column: MessageColumn,
): Promise<boolean> {
  if (!email) return false;
  try {
    const pool = await getAccPool();
    const r = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .query(
        `SELECT TOP 1 [${column}] FROM [dbo].[AccAdvClrAccess] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
      );
    return !!r.recordset[0]?.[column];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Msg 207, not 208: these are COLUMNS, so a database without 166 answers
    // "Invalid column name 'CanAdvanceMessage'" / "'CanClearMessage'" rather
    // than a missing object.
    if (msg.includes("Invalid column name") && msg.includes(column)) {
      console.error(
        `[access-message-access] migration 166 not applied — treating ${column} as not granted`,
        err,
      );
      return false;
    }
    throw err;
  }
}

/**
 * Whether this email may open AP-2's Message tab, from their own **active**
 * `AccAdvClrAccess` row.
 *
 * **A missing column degrades to `false`, never to `true`** — `CanAdvanceMessage`
 * carries a `DEFAULT 0` and is new reach, so a database that has not yet had
 * migration 166 applied must behave exactly as it did before.
 */
export async function resolveAdvanceCanMessageByEmail(
  email: string | null | undefined,
): Promise<boolean> {
  return resolveCanMessageByEmail(email, "CanAdvanceMessage");
}

/**
 * Whether this email may open AP-3's Message tab, from their own **active**
 * `AccAdvClrAccess` row. Same fail-closed rule as `resolveAdvanceCanMessageByEmail`.
 */
export async function resolveClearCanMessageByEmail(
  email: string | null | undefined,
): Promise<boolean> {
  return resolveCanMessageByEmail(email, "CanClearMessage");
}
