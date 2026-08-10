import { getAccPool, sql } from "@/lib/acc/pool";

/** Allocate the next running number, e.g. TOF26-00001. Resets per calendar year. */
export async function allocateRequestNo(prefix: string, when: Date = new Date()): Promise<string> {
  const year = when.getFullYear(); // local; server is Thai time
  const pool = await getAccPool();
  const result = await pool
    .request()
    .input("prefix", sql.NVarChar, prefix)
    .input("year", sql.Int, year)
    .query(`
      MERGE [dbo].[AccSequence] WITH (HOLDLOCK) AS t
      USING (SELECT @prefix AS Prefix, @year AS [Year]) AS s
        ON t.Prefix = s.Prefix AND t.[Year] = s.[Year]
      WHEN MATCHED THEN UPDATE SET LastSeq = t.LastSeq + 1, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (Prefix,[Year],LastSeq) VALUES (s.Prefix,s.[Year],1)
      OUTPUT inserted.LastSeq AS Seq;
    `);
  const seq = result.recordset[0].Seq as number;
  const yy = String(year).slice(-2);
  return `${prefix}${yy}-${String(seq).padStart(5, "0")}`;
}
