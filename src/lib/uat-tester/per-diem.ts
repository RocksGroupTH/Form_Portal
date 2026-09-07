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
 * `Fast_Core.dbo.UatTesterPerDiem` (migration 138) — the pool half.
 *
 * **`getUatFormPool()`, and nothing else.** This table lives in
 * `Rocks_Portal_Form_UAT` (migrations 139/141) and has no synonym anywhere:
 * nothing outside this application names it. `getUatFormPool` is a literal
 * (`getNamedPool(env.MSSQL_FORM_UAT_DATABASE)`) and consults no resolver, which
 * is what keeps it off the `getFormPool → … → getActiveUatTester → getFormPool`
 * loop. `getAccPool` IS `getFormPool`; reaching for it closes that loop.
 *
 * This module imports only the pool and its own pure half, so it introduces no
 * cycle when `allowance-log.ts` pulls it in — and `allowance-log.ts` is reached
 * from inside a `getAccPool()` transaction, where a static import of
 * `@/lib/form-environment` would be exactly the loop `getFormPool` dynamically
 * imports the resolver to avoid.
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
  IsActive: boolean;
}

function toRow(r: Rec): UatPerDiemRateRow {
  return {
    id: r.Id,
    staffId: r.StaffId,
    effectiveDate: toDateKey(r.EffectiveDate),
    amount: Number(r.Amount),
    note: r.Note,
    isActive: !!r.IsActive,
  };
}

/** Every row including inactive ones — the settings grid shows both. */
export async function listAllUatPerDiemRates(): Promise<UatPerDiemRateRow[]> {
  const pool = await getUatFormPool();
  const r = await pool.request().query<Rec>(`
    SELECT Id, StaffId, EffectiveDate, Amount, Note, IsActive
    FROM [dbo].[UatTesterPerDiem]
    ORDER BY StaffId, EffectiveDate DESC
  `);
  return r.recordset.map(toRow);
}

/**
 * One query for a whole set of testers, in `uatManagerStaffIdsFor`'s shape.
 *
 * The report resolves a rate per row and must never do a lookup per row. A
 * StaffId with no active rows is **absent from the map** rather than present
 * with `[]`, so a caller reading `map.get(id) ?? null` gets the "no override"
 * answer without restating the rule.
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
    SELECT Id, StaffId, EffectiveDate, Amount, Note, IsActive
    FROM [dbo].[UatTesterPerDiem]
    WHERE IsActive = 1 AND StaffId IN (${placeholders.join(", ")})
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
 * `UQ_UatTesterPerDiem_Staff_Date`.
 *
 * An amend sets `IsActive = 1`, so re-saving a switched-off date brings it back
 * — the same behaviour `upsertPerDiemCountryRate` has.
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
      MERGE [dbo].[UatTesterPerDiem] WITH (HOLDLOCK) AS t
      USING (SELECT @staffId AS StaffId, @eff AS EffectiveDate) AS s
        ON t.StaffId = s.StaffId AND t.EffectiveDate = s.EffectiveDate
      WHEN MATCHED THEN UPDATE SET
        Amount = @amount, Note = @note, IsActive = 1,
        UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (StaffId, EffectiveDate, Amount, Note, CreatedBy, UpdatedBy)
        VALUES (@staffId, @eff, @amount, @note, @by, @by);
    `);
}

/** The soft delete. A rate a UAT trip was already priced at is history. */
export async function setUatPerDiemRateActive(
  id: number,
  isActive: boolean,
  userId: number | null,
): Promise<void> {
  const pool = await getUatFormPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("active", sql.Bit, isActive ? 1 : 0)
    .input("by", sql.Int, userId)
    .query(`
      UPDATE [dbo].[UatTesterPerDiem]
      SET IsActive = @active, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
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
