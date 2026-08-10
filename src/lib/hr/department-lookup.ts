import { getHrPool } from "@/lib/hr/pool";

export interface HrDepartmentRow {
  id: string;
  name: string;
}

/** Active departments from Rocks_Portal_HR for mapping UI. */
export async function listHrDepartments(): Promise<HrDepartmentRow[]> {
  const pool = await getHrPool();
  const res = await pool.request().query(`
    SELECT
      CAST(d.Id AS NVARCHAR(50)) AS Id,
      d.Name
    FROM dbo.Department d
    WHERE d.IsActive = 1 OR d.IsActive IS NULL
    ORDER BY d.Name
  `);

  return (res.recordset as { Id: string; Name: string }[]).map((r) => ({
    id: r.Id,
    name: r.Name ?? "",
  }));
}

export interface DepartmentCodeRow { code: string; name: string | null }

/** Distinct active-employee DepartmentCodes, named from the Rocks_Codex master where present. */
export async function listDepartmentCodes(): Promise<DepartmentCodeRow[]> {
  const pool = await getHrPool();
  const res = await pool.request().query(`
    SELECT DISTINCT e.DepartmentCode AS Code, cd.Name AS Name
    FROM dbo.Employee e
    LEFT JOIN [Rocks_Codex].[dbo].[Department] cd
      ON cd.Code = e.DepartmentCode AND cd.IsActive = 1
    WHERE e.Status = 'Active'
      AND e.DepartmentCode IS NOT NULL AND LTRIM(RTRIM(e.DepartmentCode)) <> ''
    ORDER BY e.DepartmentCode
  `);
  return (res.recordset as { Code: string; Name: string | null }[]).map((r) => ({
    code: r.Code.trim(), name: r.Name ?? null,
  }));
}
