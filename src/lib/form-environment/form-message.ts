/**
 * Each form's notice copy — the box at the top of the form.
 *
 * Storage is `Fast_Core.dbo.FormMessage` (migration 164); see that file's
 * header for why it lives there and why there is no identity column.
 *
 * **It grants nothing and decides nothing.** It is text on a page, and every
 * gate in this application is unaware of it — the property to preserve if a
 * later change is tempted to read this table to decide something.
 */
import { getCorePool, sql } from "@/lib/db/mssql";

export interface FormMessageRow {
  body: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * True for the one error this is allowed to swallow: the table is not there.
 *
 * Anything else — a dead pool, a permission problem — is a real fault and is
 * rethrown, because silently printing "no notice" over a Fast_Core outage
 * would hide the outage without helping anybody. `form-owner.ts` draws the
 * same line for the same reason.
 */
function isMissingTable(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /Invalid object name/i.test(message) && /FormMessage/i.test(message);
}

/**
 * Every form's stored body, keyed by form code.
 *
 * **`null` means the table is missing, `{}` means it is empty** — the caller
 * has to tell those apart, because the first falls back to the constants for
 * every form and the second does not.
 */
export async function listFormMessageBodies(): Promise<Readonly<Record<string, string>> | null> {
  try {
    const pool = await getCorePool();
    const res = await pool.request().query<{ FormCode: string; BodyText: string }>(
      `SELECT FormCode, BodyText FROM [dbo].[FormMessage]`,
    );
    const out: Record<string, string> = {};
    for (const r of res.recordset) out[r.FormCode] = r.BodyText ?? "";
    return out;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/** One form's row for the settings editor, or `null` when it has none. */
export async function getFormMessage(formCode: string): Promise<FormMessageRow | null> {
  const code = formCode.trim();
  if (!code) throw new Error("formCode is required");
  try {
    const pool = await getCorePool();
    const res = await pool
      .request()
      .input("code", sql.NVarChar, code)
      .query<{ BodyText: string; UpdatedBy: string | null; UpdatedAt: Date | null }>(
        `SELECT BodyText, UpdatedBy, UpdatedAt FROM [dbo].[FormMessage] WHERE FormCode = @code`,
      );
    const row = res.recordset[0];
    if (!row) return null;
    return {
      body: row.BodyText ?? "",
      updatedBy: row.UpdatedBy ?? null,
      updatedAt: row.UpdatedAt ? row.UpdatedAt.toISOString() : null,
    };
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/**
 * Replace one form's message.
 *
 * A MERGE rather than delete-then-insert: there is exactly one row per form and
 * `FormCode` is the primary key, so there is nothing to diff. Bounded to the
 * one form — **the caller passes a literal, never a value off the wire**, which
 * is what stops a grant on one form's tab from rewriting another form's copy.
 *
 * `WITH (HOLDLOCK)` on the target, matching `booking-approver-service.ts`,
 * `reimburse/access-service.ts` and `sequence.ts`: without it, two admins
 * saving a form's *first* message at once can both miss the `WHEN MATCHED`
 * branch and both attempt the `INSERT`, and the second loses to the primary
 * key rather than being serialised into an `UPDATE`.
 */
export async function setFormMessage(
  formCode: string,
  body: string,
  actorEmail: string | null,
): Promise<void> {
  const code = formCode.trim();
  if (!code) throw new Error("formCode is required");
  const pool = await getCorePool();
  await pool
    .request()
    .input("code", sql.NVarChar, code)
    .input("body", sql.NVarChar(sql.MAX), String(body ?? ""))
    .input("by", sql.NVarChar, actorEmail || null)
    .query(
      `MERGE [dbo].[FormMessage] WITH (HOLDLOCK) AS t
       USING (SELECT @code AS FormCode) AS s ON t.FormCode = s.FormCode
       WHEN MATCHED THEN
         UPDATE SET BodyText = @body, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (FormCode, BodyText, UpdatedBy) VALUES (@code, @body, @by);`,
    );
}

/* One import path for every caller, even though the rule lives next door. */
export { FORM_MESSAGE_FALLBACK, resolveFormMessageBlocks } from "./form-message-fallback";
