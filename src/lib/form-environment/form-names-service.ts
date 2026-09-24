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
