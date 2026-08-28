import type { Direction, RequestStatus, StepCode, TravelItemType } from "./constants";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

export interface TravelExpenseItem {
  id?: number;
  itemType: TravelItemType;
  amount: number;
  sortOrder: number;
  /** AccTravelVehicleSection.Id — manual vehicle rows only. */
  vehicleSectionId?: number | null;
  files?: AccFileMeta[];
  /** Client-only: images chosen but not yet uploaded (uploaded on save/submit). */
  pendingFiles?: PendingFile[];
}

/** Manual vehicle block within a travel day (fare/toll rows). Rate vehicles use day-level route fields. */
export interface TravelVehicleSection {
  id?: number;
  sortOrder: number;
  vehicleId: number | null;
  vehicleName: string | null;
  ratePerKm: number | null;
  isManualEntry: boolean;
  items: TravelExpenseItem[];
}

export interface AccFileMeta {
  id: number; fileName: string; fileSize: number | null;
  contentType: string | null; url: string;
}

/** Client-only in-memory attachment awaiting upload. Never persisted as JSON. */
export interface PendingFile {
  localId: string;
  file: File;
  previewUrl: string;
}

/** Intermediate stop between origin and destination on a route leg. */
export interface RouteWaypoint {
  label: string;
  lat: number;
  lng: number;
}

export interface TravelExpenseDetail {
  /** AccTravelExpense.Id — present after save/load. */
  id?: number;
  sortOrder?: number;
  travelDate: string | null;
  workDetail: string | null;
  vehicleId: number | null;
  vehicleName: string | null;
  ratePerKm: number | null;
  isManualEntry: boolean;
  direction: Direction | null;
  onwardOrigin: string | null; onwardOriginLat: number | null; onwardOriginLng: number | null;
  onwardDestination: string | null; onwardDestLat: number | null; onwardDestLng: number | null;
  onwardDistanceKm: number | null;
  onwardWaypoints?: RouteWaypoint[] | null;
  returnOrigin: string | null; returnOriginLat: number | null; returnOriginLng: number | null;
  returnDestination: string | null; returnDestLat: number | null; returnDestLng: number | null;
  returnDistanceKm: number | null;
  returnWaypoints?: RouteWaypoint[] | null;
  totalDistanceKm: number | null;
  totalAmount: number | null;
  /** Manual vehicles (Grab, taxi, plane, etc.) — each with its own expense rows. */
  sections?: TravelVehicleSection[];
  /** Rate-vehicle toll/parking rows (VehicleSectionId null in DB). */
  items: TravelExpenseItem[];
}

export interface AccApproval {
  id: number; requestId: number; stepCode: StepCode; stepOrder: number;
  /** HR Employee.StaffId of the assigned approver (manager step). */
  assignedTo: number | null; assignedEmail: string | null;
  status: "Pending" | "Approved" | "Rejected" | "Returned";
  comment: string | null; isChecked: boolean | null;
  /** HR Employee.StaffId of the person who actioned this step. */
  actionedByStaffId: number | null; actionedAt: string | null; createdAt: string;
  actionedByHrName?: string | null; actionedByHrEmail?: string | null;
  assignedToHrName?: string | null; assignedToHrEmail?: string | null;
}

export interface AccRequest {
  id: number; requestNo: string | null; formCode: string; brandCode: string | null;
  status: RequestStatus; currentStepCode: StepCode | null;
  staffId: number | null; requesterFullName: string | null; requesterEmail: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null; managerStaffId: number | null; managerEmail: string | null;
  companyName: string | null;
  /**
   * **`totalAmount` is Thai baht, always** — whatever currency the claim was
   * entered in. Every summer, report, export and ERP journal reads it, and none
   * of them knows about currency; that is the whole point of converting on the
   * way in. See `src/lib/acc/currency.ts`.
   */
  totalAmount: number | null; paymentDate: string | null;
  /**
   * The currency the claim was entered in. **Null and `"THB"` both mean baht**,
   * and a baht claim leaves all three of these null — nobody recorded a
   * currency, and writing `"THB"` would claim somebody had.
   */
  currency: string | null;
  /** THB per 1 unit of `currency`, as fetched when the claim was submitted. */
  exchangeRate: number | null;
  /** The claim's own figure, before conversion. `totalAmount` is this × the rate. */
  foreignAmount: number | null;
  submittedBy: number | null; submittedAt: string | null;
  createdAt: string; updatedAt: string;
  /** One row per travel day (sorted by sortOrder). */
  travelDays?: TravelExpenseDetail[];
  /** @deprecated First day — use travelDays */
  travel?: TravelExpenseDetail;
  approvals?: AccApproval[];
}

/** Lightweight row for draft picker (no travel items / files). */
export interface TravelDraftSummary {
  id: number;
  brandCode: string | null;
  status: RequestStatus;
  travelDate: string | null;
  travelDateTo: string | null;
  dayCount: number;
  workDetail: string | null;
  totalAmount: number | null;
  updatedAt: string;
}

export interface AccVehicle {
  id: number; name: string; ratePerKm: number | null;
  isManualEntry: boolean; isActive: boolean; sortOrder: number;
  icon: string | null;
}
export interface AccApproverRow {
  id: number; staffId: number | null; email: string; displayName: string | null; isActive: boolean;
  photoUrl: string | null;
  /** null = all Interface ERP groups; string[] = explicit subset */
  interfaceBrandCodes: string[] | null;
  /**
   * Granted AP-1 settings tabs. The list IS the granted set — [] means none,
   * never all. Only keys in `GRANTABLE_SETTINGS_TABS` ever appear here.
   */
  settingsTabs: string[];
}
export interface AccSameDayBrandRow {
  id: number;
  staffId: number | null;
  email: string | null;
  displayName: string | null;
  isActive: boolean;
}
export interface AccBrandOption {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  /**
   * Every currency configured for this brand — **a list, not a code**.
   *
   * A brand may be claimed in several (`BrandCurrency`, migration 127): KSI
   * needs Thailand (THB) and England (GBP), and more later. Each row carries
   * its own `isEnabled`, so a currency can be configured and switched off
   * without losing the country beside it.
   *
   * Consumers never filter this by hand. `claimCurrencyOptions`,
   * `bookingCurrencyOptions` and `brandCurrencyState` are what decide "does
   * this brand offer a choice, and of what" — one definition of the rule, so
   * the picker and the server's own re-derivation cannot disagree.
   */
  currencies: BrandCurrencyEntry[];
}

export interface AccBrandAccountRow {
  id: number;
  brandCode: string;
  accountNo: string;
  displayName: string | null;
  erpDescription?: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AccBrandJournalBatchRow {
  id: number;
  brandCode: string;
  batchName: string;
  displayName: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AccBrandBranchRow {
  id: number;
  brandCode: string;
  branchCode: string;
  displayName: string | null;
  deptAsBranch: boolean;
  fixedErpDeptCode: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AccBrandErpConfigRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceBrandCode: string | null;
  interfaceBrandName: string | null;
  bcId: string | null;
  bcName: string | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
  interfaceMapped: boolean;
  bcProfileComplete: boolean;
  bcConfigComplete: boolean;
}

export interface AccErpTargetBrandOption {
  brandCode: string;
  brandName: string;
  bcId: string | null;
  bcName: string | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
}
