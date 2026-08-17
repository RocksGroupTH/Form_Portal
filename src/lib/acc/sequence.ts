import { getAccPool, sql } from "@/lib/acc/pool";
import { resolveFormEnvironment } from "@/lib/form-environment";

/**
 * The first number issued for a Prefix+Year `AccSequence` has never seen in
 * the UAT database. Production always starts a new Prefix+Year at 1.
 *
 * This used to be a fact about two rows seeded for 2026 only
 * (`scripts/seed-portal-form.ts`, `LastSeq = 9000`): on 1 January, a Prefix
 * this function had not seen yet in either database would insert `LastSeq = 1`
 * regardless of environment, and Production and UAT would start issuing
 * identical running numbers for the new year. Deriving the floor from the
 * resolved environment here, instead of relying on a row that only exists for
 * one year, makes the separation structural — it holds for every year, not
 * just the one somebody remembered to seed.
 *
 * **Headroom, so the next person meets this as a documented bound rather than
 * a surprise:** the running number is 5 digits, so UAT's first number for a
 * year is `09001` and Production's is `00001`. The two series stay disjoint
 * only while Production issues at most 9000 numbers for one Prefix in one year
 * — 2026 is at TOF≈46, so the margin is wide, but it is a ceiling, not an
 * invariant. Past it, a Production number would land inside UAT's band and the
 * printed numbers would collide. **Row ids never collide regardless**: that
 * separation is migration 061's 900000 identity offset, which is independent
 * of this floor (see `isUatId`, `src/lib/form-environment/uat-identity.ts`).
 */
const UAT_SEQUENCE_FLOOR = 9000;

/** Allocate the next running number, e.g. TOF26-00001. Resets per calendar year. */
export async function allocateRequestNo(prefix: string, when: Date = new Date()): Promise<string> {
  const year = when.getFullYear(); // local; server is Thai time
  const [pool, environment] = await Promise.all([getAccPool(), resolveFormEnvironment()]);
  // Only used the one time a Prefix+Year has never been seen: an existing row
  // (seeded or not) is always incremented from where it left off, so this
  // never rewinds a database's numbering once it has started for the year.
  const startSeq = environment === "UAT" ? UAT_SEQUENCE_FLOOR + 1 : 1;
  const result = await pool
    .request()
    .input("prefix", sql.NVarChar, prefix)
    .input("year", sql.Int, year)
    .input("startSeq", sql.Int, startSeq)
    .query(`
      MERGE [dbo].[AccSequence] WITH (HOLDLOCK) AS t
      USING (SELECT @prefix AS Prefix, @year AS [Year]) AS s
        ON t.Prefix = s.Prefix AND t.[Year] = s.[Year]
      WHEN MATCHED THEN UPDATE SET LastSeq = t.LastSeq + 1, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (Prefix,[Year],LastSeq) VALUES (s.Prefix,s.[Year],@startSeq)
      OUTPUT inserted.LastSeq AS Seq;
    `);
  const seq = result.recordset[0].Seq as number;
  const yy = String(year).slice(-2);
  return `${prefix}${yy}-${String(seq).padStart(5, "0")}`;
}
