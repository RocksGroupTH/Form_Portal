import { sql } from "@/lib/db/mssql";
import { getHrPool } from "@/lib/hr/pool";

/**
 * The company whose staff may approve AP-2. HR brand 4 is HQ/RPC, the entity
 * that runs the form; the group's other companies keep their own accountants.
 * Without this the picker offered KSI's and Meraki's finance staff as approvers
 * of Rocks Group documents — a different legal entity signing off the money.
 *
 * A constant rather than a parameter because the approver list is one set for
 * the whole form: the settings screen has no brand selector. If AP-2 ever gets
 * per-brand approvers, this becomes an argument.
 */
const AP2_APPROVER_HR_BRAND_ID = 4;

/**
 * Eligible AP-2 approvers: active HQ employees whose `DepartmentCode` is ACC
 * (accounting), IT, or BOD (the executive step — "ผู้บริหาร" on the settings
 * screen, which no accounting-only filter could ever populate: the CFO is
 * coded BOD, so that whole approval level had nobody to pick).
 *
 * Finance (`FN`) is deliberately excluded — decision: user, 2026-09-02.
 *
 * Selected on `Employee.DepartmentCode`, NOT on the joined `Department.Name` —
 * the two disagree in this HR database, and the name is the wrong one. Of the 28
 * active ACC-coded staff, 27 have a `DepartmentId` pointing at "Operations", and
 * the 11 people the name test did return are all coded `SC` (Supply Chain). The
 * old filter therefore returned no accountants at all: a Senior Accounting
 * Manager was missing while a Purchasing Officer was offered.
 *
 * The mismatch is in the HR data and worth fixing there too; this query stops
 * depending on it either way.
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
  const r = await pool.request().input("brand", sql.Int, AP2_APPROVER_HR_BRAND_ID).query(`
    SELECT
      e.StaffId,
      LTRIM(RTRIM(e.Email)) AS Email,
      COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e.FirstName,' ',e.LastName))), ''), e.FullName) AS FullName,
      -- Labelled from the same field the filter uses. Showing d.Name here would
      -- put "Operations" next to an accountant and read as a different bug.
      CASE e.DepartmentCode
        WHEN 'ACC' THEN N'บัญชี' WHEN 'IT' THEN N'IT' WHEN 'BOD' THEN N'ผู้บริหาร'
        ELSE e.DepartmentCode END AS DepartmentName,
      e.Position,
      COALESCE(e.PhotoOverrideUrl, e.PhotoUrl) AS PhotoUrl
    FROM dbo.Employee e
    WHERE e.Status = 'Active'
      AND e.Email IS NOT NULL AND LTRIM(RTRIM(e.Email)) <> ''
      AND e.BrandId = @brand
      AND e.DepartmentCode IN ('ACC', 'IT', 'BOD')
    ORDER BY e.DepartmentCode, FullName`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    staffId: x.StaffId as number,
    email: x.Email as string,
    fullName: (x.FullName as string) ?? "",
    departmentName: (x.DepartmentName as string) ?? null,
    position: (x.Position as string) ?? null,
    photoUrl: (x.PhotoUrl as string) ?? null,
  }));
}
