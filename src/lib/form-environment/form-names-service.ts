/**
 * Rename a form — both names, both databases, one transaction each.
 *
 * `AccFormMaster` is in `MASTER_TABLES`: it is dual-written and
 * `npm run check:alignment` compares every non-datetime column of it across
 * `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`. So a rename that reached one
 * database would not merely leave a tester reading a different name — it would
 * red the checker, which is the point of the checker. `writeBothPools` is what
 * makes that automatic; a plain `getAccPool()` write here would resolve
 * whichever database the *route* happened to pick and silently do exactly that.
 *
 * `UpdatedAt` is set with `SYSDATETIME()` rather than a JS `Date`, like every
 * other write in this repo: the two databases stamp their own clocks and the
 * alignment checker excludes datetime columns for exactly that reason.
 *
 * The validation is `form-name-input.ts`, which imports nothing — the route
 * calls it before this, so a refused rename never opens a transaction.
 */
import { sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { getProductionFormPool } from "@/lib/db/mssql";

export async function setFormNames(
  formCode: string,
  nameTh: string,
  nameEn: string,
): Promise<boolean> {
  const code = formCode.trim();
  if (!code) throw new Error("formCode is required");

  let matched = 0;
  await writeBothPools(async (tx) => {
    const r = await tx
      .request()
      .input("code", sql.NVarChar, code)
      .input("th", sql.NVarChar, nameTh)
      .input("en", sql.NVarChar, nameEn)
      .query(`UPDATE [dbo].[AccFormMaster]
                 SET FormNameTh = @th, FormNameEn = @en, UpdatedAt = SYSDATETIME()
               WHERE FormCode = @code`);
    /* Read off the production pass, which `writeBothPools` runs first. A code
       that matches nothing is an admin renaming a form this database has never
       heard of — worth a 404 rather than a silent success. */
    if (matched === 0) matched = r.rowsAffected[0] ?? 0;
  });
  return matched > 0;
}

/** One form's canonical, admin-editable name pair. */
export interface CanonicalFormNames {
  nameTh: string;
  nameEn: string;
}

/** True for the one error this is allowed to swallow: the table is not there. */
function isMissingAccFormMaster(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /Invalid object name/i.test(message) && /AccFormMaster/i.test(message);
}

/**
 * Every form's canonical name pair, keyed by `FormCode`.
 *
 * Read through **`getProductionFormPool()`**, never `getFormPool()`/`getAccPool()`:
 * `AccFormMaster` is dual-written (`setFormNames` above), so both databases
 * already hold identical names, and production is the stable choice that does
 * not vary with which database the *caller's own* request happens to resolve
 * to — Home's catalogue reads this for every viewer alike, tester or not.
 *
 * Degrades like `form-owner.ts`'s `listFormOwners`: a missing table answers
 * `{}` rather than throwing, and every other failure is rethrown, because
 * silently printing no names over a real fault would hide the fault without
 * helping anybody. A form absent from the result is a code the caller should
 * fall back on, not one it should render blank.
 */
export async function listFormNames(): Promise<Readonly<Record<string, CanonicalFormNames>>> {
  let rows: { FormCode: string; FormNameTh: string; FormNameEn: string }[];
  try {
    const pool = await getProductionFormPool();
    const res = await pool.request().query<{
      FormCode: string;
      FormNameTh: string;
      FormNameEn: string;
    }>(`SELECT FormCode, FormNameTh, FormNameEn FROM [dbo].[AccFormMaster]`);
    rows = res.recordset;
  } catch (e) {
    if (isMissingAccFormMaster(e)) return {};
    throw e;
  }

  const out: Record<string, CanonicalFormNames> = {};
  for (const r of rows) {
    out[r.FormCode] = { nameTh: r.FormNameTh, nameEn: r.FormNameEn };
  }
  return out;
}
