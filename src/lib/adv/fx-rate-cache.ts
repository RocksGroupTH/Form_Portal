import { getProductionFormPool, sql } from "@/lib/db/mssql";
import {
  canServeCached,
  type FxCacheKey,
  type FxCacheSource,
  type CachedFxRow,
} from "./fx-cache-policy";

/**
 * The database half of the FX cache — `dbo.FxRateCache`, migration 137.
 *
 * Holds no decisions: what the key is and when a row may be served live in
 * `fx-cache-policy.ts`, which imports nothing and is unit-tested. This file is
 * the two queries.
 *
 * **`getProductionFormPool()`, never `getAccPool()`.** The table is
 * production-only with no UAT twin, so the environment-resolved pool would
 * answer `Invalid object name` **for a UAT tester and for nobody else** — the
 * hazard CLAUDE.md records for `DepartmentErpMap`, `BrandCurrency` and
 * `ApiKey`. It is also the right answer on its own terms: a rate is a fact
 * about a day, and the two environments must not disagree about what a claim
 * is worth.
 *
 * **Both functions swallow their own failures.** A cache is an optimisation; it
 * must never be the reason a requester cannot file a claim. `readCachedFxRate`
 * answers null on any error, which the caller reads as a miss, and
 * `writeCachedFxRate` returns quietly. The visible consequence of the table
 * being absent — a deployment that has not applied 137 — is more API calls, not
 * an outage.
 */

export async function readCachedFxRate(
  key: FxCacheKey,
): Promise<{ rate: number; asOf: string; source: FxCacheSource } | null> {
  try {
    const pool = await getProductionFormPool();
    const r = await pool
      .request()
      .input("cur", sql.Char(3), key.currency)
      .input("qd", sql.Date, key.queryDate)
      .input("src", sql.NVarChar(10), key.source)
      .query(`
        SELECT TOP 1 Rate, RateAsOf, Source
        FROM [dbo].[FxRateCache]
        WHERE Currency = @cur AND QueryDate = @qd AND Source = @src
      `);
    const row = r.recordset[0] as { Rate: unknown; RateAsOf: Date; Source: string } | undefined;
    if (!row) return null;

    const cached: CachedFxRow = {
      // DECIMAL comes back as a string on some driver configurations, so this
      // is coerced rather than cast — and then checked, not trusted.
      rate: Number(row.Rate),
      asOf: ymdOf(row.RateAsOf),
      source: row.Source,
    };
    if (!canServeCached(cached, key.source)) return null;
    return { rate: cached.rate, asOf: cached.asOf, source: key.source };
  } catch {
    // Table missing, pool down, anything: a miss, and the caller fetches.
    return null;
  }
}

export async function writeCachedFxRate(
  key: FxCacheKey,
  rate: number,
  asOf: string,
): Promise<void> {
  // Never cache something we would refuse to serve. `CK_FxRateCache_Rate` would
  // reject it anyway, but throwing inside a best-effort write buys nothing.
  if (!Number.isFinite(rate) || rate <= 0) return;
  // `CK_FxRateCache_AsOf` forbids a provider date later than the day asked
  // about. That is a real constraint violation rather than a value to clamp, so
  // skip the write instead of storing a row that misrepresents either date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || asOf > key.queryDate) return;

  try {
    const pool = await getProductionFormPool();
    await pool
      .request()
      .input("cur", sql.Char(3), key.currency)
      .input("qd", sql.Date, key.queryDate)
      .input("src", sql.NVarChar(10), key.source)
      .input("rate", sql.Decimal(18, 6), rate)
      .input("asOf", sql.Date, asOf)
      .query(`
        -- MERGE on the unique key, so two requests that missed at the same
        -- moment converge on one row instead of racing to insert twice. The
        -- later one refreshes FetchedAt, which is the only thing that can
        -- legitimately differ.
        MERGE [dbo].[FxRateCache] WITH (HOLDLOCK) AS t
        USING (SELECT @cur AS Currency, @qd AS QueryDate, @src AS Source) AS s
          ON t.Currency = s.Currency AND t.QueryDate = s.QueryDate AND t.Source = s.Source
        WHEN MATCHED THEN UPDATE SET
          Rate = @rate, RateAsOf = @asOf, FetchedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (Currency, QueryDate, Source, Rate, RateAsOf)
          VALUES (@cur, @qd, @src, @rate, @asOf);
      `);
  } catch {
    // Best effort. A cache that cannot be written is not an error the requester
    // should ever see.
  }
}

/** A `date` column arrives as a Date; render it in local time, never via ISO. */
function ymdOf(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
