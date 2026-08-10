import { sql } from "@/lib/db/mssql";
import { getHrPool } from "@/lib/hr/pool";
import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";

/**
 * Effective-dated per-diem allowance history for one employee
 * (Rocks_Portal_HR.dbo.EmployeeAllowanceLog), keyed by Employee.Id (uniqueidentifier).
 * Feeds `computePerDiem` (see `src/lib/acc/travel-booking/perdiem.ts`).
 */
export async function getAllowanceLog(employeeId: string): Promise<AllowanceLogEntry[]> {
  const pool = await getHrPool();
  const r = await pool.request()
    .input("id", sql.UniqueIdentifier, employeeId)
    .query(`
      SELECT EffectiveDate, Amount
      FROM [dbo].[EmployeeAllowanceLog]
      WHERE EmployeeId = @id
      ORDER BY EffectiveDate
    `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    effectiveDate: toDateKey(x.EffectiveDate as Date),
    amount: Number(x.Amount),
  }));
}

/** Format a local Date back to a 'YYYY-MM-DD' string using local getters (never toISOString — server is Thai time). */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
