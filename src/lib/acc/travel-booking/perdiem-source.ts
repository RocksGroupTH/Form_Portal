import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
import {
  PER_DIEM_HOME_COUNTRY,
  isPerDiemCountry,
  perDiemLogFor,
  type PerDiemCountryRate,
} from "@/lib/acc/travel-booking/perdiem-country";

/**
 * The pool half of per-diem-by-country.
 *
 * `AccTravelPerDiemCountry` (migration 133) is **shared configuration, present
 * in both form databases and dual-written**, so reads go through
 * `getAccPool()` — the environment-varying pool — and not
 * `getProductionFormPool()`. That is the opposite of `TravelProvince` and
 * `BrandCurrency`, which have one physical copy, and the reason is that a UAT
 * tester rehearsing a trip must see the rates their UAT environment holds.
 *
 * ── One resolver, and the guard that keeps it one ──
 *
 * `getAllowanceLog` is imported here and, apart from the route that serves the
 * requester's own allowance history unchanged, nowhere else that prices a trip.
 * Four things compute a per-diem figure — the estimate on the form, the submit,
 * the recompute after a cancellation, and the report's displayed rate — and
 * they disagreed about nothing before because there was only one input. Adding
 * a second input is exactly the kind of change that lets them drift, so they
 * all come through `perDiemLogFor`.
 */

/**
 * Every active country rate, both databases' own.
 *
 * Ordered so a caller that hands the whole list to `perDiemCountryLog` gets a
 * sorted log for free, though that function sorts anyway rather than trusting
 * this.
 */
export async function listPerDiemCountryRates(): Promise<PerDiemCountryRate[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT CountryCode, EffectiveDate, Amount
    FROM [dbo].[AccTravelPerDiemCountry]
    WHERE IsActive = 1
    ORDER BY CountryCode, EffectiveDate
  `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    countryCode: ((x.CountryCode as string) ?? "").trim().toUpperCase(),
    effectiveDate: toDateKey(x.EffectiveDate as Date),
    amount: Number(x.Amount),
  }));
}

/** Every row including inactive ones — the settings grid. */
export interface PerDiemCountryRow extends PerDiemCountryRate {
  id: number;
  note: string | null;
  isActive: boolean;
}

export async function listAllPerDiemCountryRates(): Promise<PerDiemCountryRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, CountryCode, EffectiveDate, Amount, Note, IsActive
    FROM [dbo].[AccTravelPerDiemCountry]
    ORDER BY CountryCode, EffectiveDate DESC
  `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    countryCode: ((x.CountryCode as string) ?? "").trim().toUpperCase(),
    effectiveDate: toDateKey(x.EffectiveDate as Date),
    amount: Number(x.Amount),
    note: (x.Note as string) ?? null,
    isActive: !!x.IsActive,
  }));
}

export class PerDiemRateError extends Error {}

/**
 * Add or amend one country's rate, in both databases.
 *
 * `writeBothPools` runs the same statement against each and reads no id back,
 * which is what keeps the two identity counters in lockstep — and why this table
 * must stay out of migrations 061/064's 900000 floor.
 *
 * Both refusals happen here rather than at the CHECK constraint, so the message
 * is Thai and names the problem instead of surfacing a constraint violation.
 */
export async function upsertPerDiemCountryRate(
  row: { countryCode: string; effectiveDate: string; amount: number; note?: string | null },
  userId: number | null,
): Promise<void> {
  const country = (row.countryCode ?? "").trim().toUpperCase();

  // TH is refused because it is the home country: the employee's HR allowance
  // is already the answer there, and a TH row would be a second one.
  if (country === PER_DIEM_HOME_COUNTRY) {
    throw new PerDiemRateError("ประเทศไทยใช้เบี้ยเลี้ยงตามข้อมูล HR ของพนักงาน — กำหนดเรทที่นี่ไม่ได้");
  }
  if (!isPerDiemCountry(country)) {
    throw new PerDiemRateError("กรุณาเลือกประเทศจากรายการ");
  }
  // Not hygiene: rateForDay answers 0 for a day it cannot match, so a stored 0
  // would look configured and pay nothing.
  if (!Number.isFinite(row.amount) || row.amount <= 0) {
    throw new PerDiemRateError("จำนวนเงินต่อวันต้องมากกว่า 0");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.effectiveDate)) {
    throw new PerDiemRateError("กรุณาเลือกวันที่เริ่มมีผล");
  }

  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("country", sql.Char(2), country)
      .input("eff", sql.Date, row.effectiveDate)
      .input("amount", sql.Decimal(18, 2), row.amount)
      .input("note", sql.NVarChar(300), (row.note ?? "").trim() || null)
      .input("user", sql.Int, userId)
      .query(`
        MERGE [dbo].[AccTravelPerDiemCountry] AS t
        USING (SELECT @country AS CountryCode, @eff AS EffectiveDate) AS s
          ON t.CountryCode = s.CountryCode AND t.EffectiveDate = s.EffectiveDate
        WHEN MATCHED THEN UPDATE SET
          Amount = @amount, Note = @note, IsActive = 1,
          UpdatedBy = @user, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (CountryCode, EffectiveDate, Amount, Note, CreatedBy, UpdatedBy)
          VALUES (@country, @eff, @amount, @note, @user, @user);
      `);
  });
}

/** The soft delete, in both databases. A rate a trip was priced at is history. */
export async function setPerDiemCountryRateActive(
  id: number,
  isActive: boolean,
  userId: number | null,
): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("active", sql.Bit, isActive ? 1 : 0)
      .input("user", sql.Int, userId)
      .query(`UPDATE [dbo].[AccTravelPerDiemCountry]
              SET IsActive = @active, UpdatedBy = @user, UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);
  });
}

/**
 * The convenience wrapper for a caller holding one request.
 *
 * Two queries. A caller with a whole group in hand should load the two lists
 * itself and call `perDiemLogFor` per trip instead — the country is per trip, so
 * this would otherwise be two queries per trip.
 */
export async function resolvePerDiemLog(
  employeeId: string | null,
  countryCode: string | null,
): Promise<ReturnType<typeof perDiemLogFor>> {
  const [log, rates] = await Promise.all([
    employeeId ? getAllowanceLog(employeeId) : Promise.resolve([]),
    listPerDiemCountryRates(),
  ]);
  return perDiemLogFor(countryCode, log, rates);
}

/** Local getters, never toISOString — the server runs on Thai wall clock. */
function toDateKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}
