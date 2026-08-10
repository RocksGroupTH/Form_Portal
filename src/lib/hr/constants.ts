/** HR database on the app MSSQL server (same host as Fast_Core). */
export const PORTAL_HR_DATABASE = "Rocks_Portal_HR";

/** Cross-DB reference: Rocks_Portal_HR.dbo.Employee */
export function hrEmployeeTable(): string {
  return `[${PORTAL_HR_DATABASE}].[dbo].[Employee]`;
}

/** Employee.Status value for active staff. */
export const EMPLOYEE_STATUS_ACTIVE = "Active";
