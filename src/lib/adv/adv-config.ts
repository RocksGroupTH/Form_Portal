import { getAccPool, sql } from "@/lib/adv/pool";

/**
 * AP-2-local versions of the two config/counter reads that AP-1 serves through
 * getFormPool. AP-2 keeps everything on its own (UAT) pool so it never depends
 * on the per-form environment routing — nothing here touches other forms.
 */

/** Running number for AP-2 (e.g. ADV26-00001), from the AP-2 pool's AccSequence. */
export async function allocateAdvanceRequestNo(
  prefix: string,
  when: Date = new Date(),
): Promise<string> {
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
  return `${prefix}${String(year).slice(-2)}-${String(seq).padStart(5, "0")}`;
}

/** Active accounting approver emails from AP-2's own AccAdvanceApprover table. */
export async function listAdvanceApproverEmails(): Promise<string[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Email FROM [dbo].[AccAdvanceApprover] WHERE IsActive = 1 ORDER BY DisplayName, Email
  `);
  return (r.recordset as { Email: string | null }[])
    .map((x) => x.Email)
    .filter((e): e is string => !!e && e.trim() !== "");
}
