import { getUatFormPool, sql } from "@/lib/db/mssql";
import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";
import {
  parseUatPerDiemInput,
  uatPerDiemLogFrom,
  UatPerDiemInputError,
  type UatPerDiemRateRow,
} from "./per-diem-rule";

export { UatPerDiemInputError };
export type { UatPerDiemRateRow };

/**
 * `TesterPerDiem` lives in `Rocks_Portal_Form_UAT` (migrations 139/140), not
 * in `Fast_Core` where migration 138 first created it as `UatTesterPerDiem` —
 * this is the pool half. **Migration 142 dropped the `Uat` prefix**: the
 * database is UAT by definition and every other table in it is unprefixed
 * (`AccRequest`, not `UatAccRequest`), so the prefix was a leftover from the
 * shared `Fast_Core` home where it did work. **The TypeScript symbols keep
 * theirs on purpose** — `uatPerDiemLogFor`, `UatPerDiemRateRow`, this whole
 * directory — because they are called from code that runs in both environments
 * and sit beside `getAllowanceLog` (the HR source), where `uat` is what says
 * which log is the override. The table and the symbols differ deliberately.
 * `UatTester` itself did NOT move and stays in `Fast_Core`; only this table did
 * — see the design doc's §2 and §12 for why.
 *
 * **`getUatFormPool()`, and nothing else.** This table lives in
 * `Rocks_Portal_Form_UAT` (migrations 139/140) and has no synonym anywhere:
 * nothing outside this application names it. `getUatFormPool` is a literal
 * (`getNamedPool(env.MSSQL_FORM_UAT_DATABASE)`) and consults no resolver, which
 * is what keeps it off the `getFormPool → … → getActiveUatTester → getFormPool`
 * loop. `getAccPool` IS `getFormPool`; reaching for it closes that loop.
 *
 * One consequence of the move worth naming, harmless but real: `getNamedPool`
 * caches by database name, so **in UAT `getFormPool()` and `getUatFormPool()`
 * hand back the same pool object**. `recomputeGroupPerDiem` calls
 * `getPerDiemEmployeeLog` inside its own open transaction, so that read now
 * takes a second connection from the pool the transaction is already holding
 * one from -- where before the move it came from `Fast_Core`'s separate
 * budget. It cannot deadlock (the transaction never touches
 * `TesterPerDiem`) and pool max is 30 against a handful of testers, so
 * this is a note, not a risk.
 *
 * This module imports only the pool and its own pure half, so it introduces no
 * cycle when `allowance-log.ts` pulls it in — and `allowance-log.ts` is reached
 * from inside a `getAccPool()` transaction, where a static import of
 * `@/lib/form-environment` would be exactly the loop `getFormPool` dynamically
 * imports the resolver to avoid.
 *
 * **No `IsActive`, on purpose — this table follows HR.** Every stored rate
 * counts and the effective date alone selects, exactly as `getAllowanceLog`
 * treats `Rocks_Portal_HR.dbo.EmployeeAllowanceLog`, which has no such column
 * and whose query has no filter. The flag was dropped by migration 143 — the
 * file after the one that renamed this table — after a
 * tester's rates were switched off and the override did not go blank, it went
 * away — pricing them at their real HR salary with nothing on screen to say so.
 *
 * **The near-identical twin keeps its flag, and that is not an inconsistency.**
 * `AccTravelPerDiemCountry` (`src/lib/acc/travel-booking/perdiem-source.ts`)
 * has the same shape, the same settings panel and a `setPerDiemCountryRateActive`
 * of the same name — and its pricing genuinely does filter `IsActive = 1`. Edit
 * this table's code by exact path, never by grepping `isActive`, `toggle` or
 * "The soft delete": each of those returns hits in both, and only these are safe
 * to change. The rename does not help here — `TesterPerDiem` and
 * `AccTravelPerDiemCountry` both still answer a `PerDiem` grep, exactly as
 * `UatTesterPerDiem` did.
 *
 * **A missing table throws.** It is not degraded to "no override": the read is
 * reached only in UAT, so an unapplied migration errors UAT AP-17 loudly rather
 * than silently pricing a tester at their real HR allowance and writing that to
 * `AccRequest.TotalAmount`.
 */

interface Rec {
  Id: number;
  StaffId: number;
  EffectiveDate: Date;
  Amount: number;
  Note: string | null;
}

function toRow(r: Rec): UatPerDiemRateRow {
  return {
    id: r.Id,
    staffId: r.StaffId,
    effectiveDate: toDateKey(r.EffectiveDate),
    amount: Number(r.Amount),
    note: r.Note,
  };
}

/** Every stored row — the settings grid lists a tester's whole rate history. */
export async function listAllUatPerDiemRates(): Promise<UatPerDiemRateRow[]> {
  const pool = await getUatFormPool();
  const r = await pool.request().query<Rec>(`
    SELECT Id, StaffId, EffectiveDate, Amount, Note
    FROM [dbo].[TesterPerDiem]
    ORDER BY StaffId, EffectiveDate DESC
  `);
  return r.recordset.map(toRow);
}

/**
 * One query for a whole set of testers, in `uatManagerStaffIdsFor`'s shape.
 *
 * The report resolves a rate per row and must never do a lookup per row. A
 * StaffId with no rows **at all** is absent from the map rather than present
 * with `[]`, so a caller reading `map.get(id) ?? null` gets the "no override"
 * answer without restating the rule. "No rows at all" is the only way to be
 * absent now — there is no flag to be switched off, and no delete.
 */
export async function uatPerDiemLogsByStaffIds(
  staffIds: readonly number[],
): Promise<Map<number, AllowanceLogEntry[]>> {
  const out = new Map<number, AllowanceLogEntry[]>();
  const ids = Array.from(
    new Set(staffIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (ids.length === 0) return out;

  const pool = await getUatFormPool();
  const req = pool.request();
  const placeholders: string[] = [];
  ids.forEach((id, i) => {
    req.input(`s${i}`, sql.Int, id);
    placeholders.push(`@s${i}`);
  });
  const r = await req.query<Rec>(`
    SELECT Id, StaffId, EffectiveDate, Amount, Note
    FROM [dbo].[TesterPerDiem]
    WHERE StaffId IN (${placeholders.join(", ")})
    ORDER BY StaffId, EffectiveDate
  `);

  const byStaffId = new Map<number, UatPerDiemRateRow[]>();
  for (const rec of r.recordset) {
    const row = toRow(rec);
    const list = byStaffId.get(row.staffId) ?? [];
    list.push(row);
    byStaffId.set(row.staffId, list);
  }
  byStaffId.forEach((rows, staffId) => {
    const log = uatPerDiemLogFrom(rows);
    if (log) out.set(staffId, log);
  });
  return out;
}

/** One tester's log, or `null` — the single-subject convenience over the batch. */
export async function uatPerDiemLogFor(
  staffId: number | null | undefined,
): Promise<AllowanceLogEntry[] | null> {
  if (typeof staffId !== "number" || !Number.isInteger(staffId) || staffId <= 0) return null;
  const map = await uatPerDiemLogsByStaffIds([staffId]);
  return map.get(staffId) ?? null;
}

/**
 * Add or amend one tester's rate for one effective date.
 *
 * `MERGE ... WITH (HOLDLOCK)` in one statement, the idiom `upsertUatTester` and
 * `setFormFlag` already use: an `UPDATE` then `IF @@ROWCOUNT = 0 INSERT` pair is
 * two autocommit transactions, so two concurrent upserts for the same
 * `(StaffId, EffectiveDate)` could both see zero rows updated and race onto
 * `UQ_TesterPerDiem_Staff_Date`.
 *
 * Re-saving an existing effective date **overwrites** that date's amount and
 * note. That is the only way to correct a rate: there is no flag and no delete,
 * so a row saved against the wrong DATE stays, exactly as it would in HR. The
 * remedy there is the same one — another dated row.
 */
export async function upsertUatPerDiemRate(
  raw: { staffId: unknown; effectiveDate: unknown; amount: unknown; note?: unknown },
  userId: number | null,
): Promise<void> {
  const input = parseUatPerDiemInput(raw);
  const pool = await getUatFormPool();
  await pool
    .request()
    .input("staffId", sql.Int, input.staffId)
    .input("eff", sql.Date, input.effectiveDate)
    .input("amount", sql.Decimal(18, 2), input.amount)
    .input("note", sql.NVarChar(300), input.note)
    .input("by", sql.Int, userId)
    .query(`
      MERGE [dbo].[TesterPerDiem] WITH (HOLDLOCK) AS t
      USING (SELECT @staffId AS StaffId, @eff AS EffectiveDate) AS s
        ON t.StaffId = s.StaffId AND t.EffectiveDate = s.EffectiveDate
      WHEN MATCHED THEN UPDATE SET
        Amount = @amount, Note = @note,
        UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (StaffId, EffectiveDate, Amount, Note, CreatedBy, UpdatedBy)
        VALUES (@staffId, @eff, @amount, @note, @by, @by);
    `);
}

/** Local getters, never toISOString — the server runs on Thai wall clock. */
function toDateKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
