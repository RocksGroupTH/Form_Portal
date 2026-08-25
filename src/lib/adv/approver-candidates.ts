import { getHrPool } from "@/lib/hr/pool";

/**
 * Eligible AP-2 approvers: active employees in Accounting (any department whose
 * name contains "Account"/"บัญชี") or IT. The picker on the settings page draws
 * only from here, so an AP-2 approver can never be someone outside those teams.
 */
export interface ApproverCandidate {
  staffId: number;
  email: string;
  fullName: string;
  departmentName: string | null;
  position: string | null;
  photoUrl: string | null;
}

export async function listApproverCandidates(): Promise<ApproverCandidate[]> {
  const pool = await getHrPool();
  const r = await pool.request().query(`
    SELECT
      e.StaffId,
      LTRIM(RTRIM(e.Email)) AS Email,
      COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e.FirstName,' ',e.LastName))), ''), e.FullName) AS FullName,
      d.Name AS DepartmentName,
      e.Position,
      COALESCE(e.PhotoOverrideUrl, e.PhotoUrl) AS PhotoUrl
    FROM dbo.Employee e
    LEFT JOIN dbo.Department d ON d.Id = CAST(e.DepartmentId AS nvarchar(50))
    WHERE e.Status = 'Active'
      AND e.Email IS NOT NULL AND LTRIM(RTRIM(e.Email)) <> ''
      AND (
        d.Name LIKE '%Account%'
        OR d.Name LIKE N'%บัญชี%'
        OR e.DepartmentCode = 'IT'
        OR d.Name LIKE '%Information Technology%'
      )
    ORDER BY d.Name, FullName`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    staffId: x.StaffId as number,
    email: x.Email as string,
    fullName: (x.FullName as string) ?? "",
    departmentName: (x.DepartmentName as string) ?? null,
    position: (x.Position as string) ?? null,
    photoUrl: (x.PhotoUrl as string) ?? null,
  }));
}
