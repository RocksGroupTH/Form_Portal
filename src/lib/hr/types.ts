/** How the Employee row was matched to the logged-in user. */
export type EmployeeMatchMethod = "email" | "emailCompBr";

/** Brand row from Rocks_Portal_HR.dbo.HrBrand (camelCase API shape). */
export interface HrBrandInfo {
  id: number;
  code: string;
  name: string;
  color: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyTaxId: string | null;
  companyPhone: string | null;
  logoPath: string | null;
}

/** Active employee + brand context for Request pre-fill (camelCase). */
export interface EmployeeContext {
  id: string;
  staffId: number;
  brandId: number;
  employeeType: string;
  fullName: string;
  fullNameTh: string | null;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailCompBr: string | null;
  phone: string | null;
  bankAccountNo: string | null;
  /** Standing per-diem/travel allowance rate (Employee.Allowance) — informational; AP-17 snapshots this. */
  allowance: number | null;
  position: string | null;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
  subDepartmentId: number | null;
  locationId: number | null;
  managerStaffId: number | null;
  teamMemberId: number | null;
  adUserId: string | null;
  status: string;
  /** PhotoOverrideUrl ?? PhotoUrl from HR */
  photoUrl: string | null;
  brand: HrBrandInfo;
}

/** Snapshot fields to persist on request submit (audit). */
export interface RequesterSnapshot {
  employeeId: string;
  staffId: number;
  hrBrandId: number;
  hrBrandCode: string;
  requesterFullName: string;
  requesterFullNameTh: string | null;
  requesterEmail: string | null;
  requesterPhone: string | null;
  requesterPosition: string | null;
  requesterDepartmentId: number | null;
  requesterDepartmentName: string | null;
  requesterDepartmentCode: string | null;
  managerStaffId: number | null;
  companyName: string | null;
  companyTaxId: string | null;
}

export interface EmployeeLookupResult {
  employee: EmployeeContext | null;
  matchMethod: EmployeeMatchMethod | null;
}
