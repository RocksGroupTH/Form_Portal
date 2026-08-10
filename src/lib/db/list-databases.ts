import { getExternalPool } from "@/lib/db/external-pool";

const SYSTEM_DBS = ["master", "tempdb", "model", "msdb"];

/** List user databases on an external MSSQL connection (server-level). */
export async function listConnectionDatabases(connectionId: number): Promise<string[]> {
  const pool = await getExternalPool(connectionId);
  const result = await pool.request().query(`
    SELECT name
    FROM sys.databases
    WHERE database_id > 4
      AND state_desc = N'ONLINE'
    ORDER BY name
  `);

  const names = (result.recordset as { name: string }[])
    .map((r) => r.name)
    .filter((n) => !SYSTEM_DBS.includes(n.toLowerCase()));

  return names;
}
