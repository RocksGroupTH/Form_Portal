/**
 * Who owns each form — the people a requester is told to contact.
 *
 * Storage is `Fast_Core.dbo.FormOwner` (migration 163); see that file's header
 * for why it lives there, why there is no `IsActive`, and why the display name
 * is a snapshot while the address is the key.
 *
 * **An owner grants nothing.** Naming somebody here does not let them approve,
 * cancel, configure or read anything. It is a contact line at the foot of a
 * form, and every gate in this application is unaware of it — which is the
 * property to preserve if a later change is tempted to read this table to
 * decide something.
 *
 * The read degrades rather than throwing: a missing table (the window before
 * 163 is applied) or an unreadable Fast_Core answers "no owners", and the forms
 * then print the bare sentence they printed before this existed. A contact line
 * is worth exactly nothing compared with the page it sits on, so it must never
 * be the thing that takes that page down.
 */
import { getCorePool } from "@/lib/db/mssql";
import { sql } from "@/lib/db/mssql";

export interface FormOwner {
  /** What a requester actually contacts. Lower-cased on the way in. */
  email: string;
  /** As the directory read it when an admin picked them; may be stale. */
  displayName: string | null;
  staffId: number | null;
}

/** Every form's owners, keyed by form code. Forms with none are simply absent. */
export type FormOwnerMap = Readonly<Record<string, readonly FormOwner[]>>;

const EMPTY: FormOwnerMap = Object.freeze({});

/**
 * True for the one error this is allowed to swallow: the table is not there.
 *
 * Anything else — a dead pool, a permission problem — is a real fault and is
 * rethrown, because silently printing "no owners" over a Fast_Core outage would
 * hide the outage without helping anybody.
 */
function isMissingTable(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /Invalid object name/i.test(message) && /FormOwner/i.test(message);
}

export async function listFormOwners(): Promise<FormOwnerMap> {
  let rows: { FormCode: string; Email: string; DisplayName: string | null; StaffId: number | null }[];
  try {
    const pool = await getCorePool();
    const res = await pool.request().query<{
      FormCode: string;
      Email: string;
      DisplayName: string | null;
      StaffId: number | null;
    }>(
      `SELECT FormCode, Email, DisplayName, StaffId
       FROM [dbo].[FormOwner]
       ORDER BY FormCode, DisplayName, Email`,
    );
    rows = res.recordset;
  } catch (e) {
    if (isMissingTable(e)) return EMPTY;
    throw e;
  }

  const out: Record<string, FormOwner[]> = {};
  for (const r of rows) {
    (out[r.FormCode] ??= []).push({
      email: r.Email,
      displayName: r.DisplayName,
      staffId: r.StaffId,
    });
  }
  return out;
}

/**
 * Replace one form's owners with exactly this list, in one transaction.
 *
 * Delete-then-insert rather than a diff: the list is a handful of rows edited
 * by hand a few times a year, and a diff would have to decide what an "unchanged"
 * row is when the display name has moved on — which is the case a re-save exists
 * to fix. Bounded to the one form, so saving AP-1's owners cannot touch AP-17's.
 */
export async function setFormOwners(
  formCode: string,
  owners: readonly { email: string; displayName?: string | null; staffId?: number | null }[],
  userId: number,
): Promise<void> {
  const code = formCode.trim();
  if (!code) throw new Error("formCode is required");

  /* De-duplicated on the way in, on the same key the unique index uses. Two
     picks of one person is an ordinary slip in a search-and-add dialog, and it
     should not come back as a constraint violation the admin has to decode. */
  const seen = new Set<string>();
  const clean = owners
    .map((o) => ({
      email: o.email.trim().toLowerCase(),
      displayName: o.displayName?.trim() || null,
      staffId: typeof o.staffId === "number" && Number.isFinite(o.staffId) ? o.staffId : null,
    }))
    .filter((o) => {
      if (!o.email || seen.has(o.email)) return false;
      seen.add(o.email);
      return true;
    });

  const pool = await getCorePool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx
      .request()
      .input("code", sql.NVarChar, code)
      .query(`DELETE FROM [dbo].[FormOwner] WHERE FormCode = @code`);

    for (const o of clean) {
      await tx
        .request()
        .input("code", sql.NVarChar, code)
        .input("email", sql.NVarChar, o.email)
        .input("name", sql.NVarChar, o.displayName)
        .input("staff", sql.Int, o.staffId)
        .input("by", sql.Int, userId || null)
        .query(
          `INSERT INTO [dbo].[FormOwner] (FormCode, Email, DisplayName, StaffId, UpdatedBy)
           VALUES (@code, @email, @name, @staff, @by)`,
        );
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}
