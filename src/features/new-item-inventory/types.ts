import type { ItemType, RequestStatus, StepCode } from "./constants";

/* ── Lookup ── */

/** A single option returned by a lookup endpoint. */
export interface LookupOption {
  value: string;
  label: string;
  meta?: Record<string, unknown>;
}

/** Resource names served by the lookup API. */
export type LookupResource =
  | "vendors"
  | "stock-counting"
  | "uom"
  | "no-series"
  | "purchasing-code"
  | "gen-prod-posting-group"
  | "vat-prod-posting-group"
  | "inventory-posting-group"
  | "item-categories"
  | "locations";

/* ── Request ── */

export interface NiiPriceRow {
  id?: number;
  priceInclSST: number | null;
  moq: number | null;
  unit: string | null;
  sortOrder: number;
}

export interface NiiUomRow {
  id?: number;
  uom1Code: string | null;
  qty: number | null;
  uom2Code: string | null;
  sortOrder: number;
}

/** Costing ACC fields, filled by the approver at step 4. */
export interface CostingAccFields {
  noSeriesCode: string | null;
  itemTypeAcc: string | null;
  allowInvoiceDisc: boolean | null;
  costingMethod: string | null;
  purchasingCode: string | null;
  genProdPostingGroup: string | null;
  vatProdPostingGroup: string | null;
  inventoryPostingGroup: string | null;
  itemCategoryCode: string | null;
  physInvtCountingPeriodCode: string | null;
}

/** A full request as returned by the API (camelCase). */
export interface NiiRequest {
  id: number;
  requestNo: string | null;
  brandCode: string;
  itemType: ItemType;
  itemFor: string;
  descriptionTH: string | null;
  descriptionEN: string | null;
  itemReference: string | null;
  vendorNo: string | null;
  vendorName: string | null;
  locationCode: string | null;
  packSize: string | null;
  stockCountingCode: string | null;
  baseUomCode: string | null;
  purchUomCode: string | null;
  salesUomCode: string | null;
  leadtimeFirstLot: number | null;
  leadtimeReorder: number | null;
  costingAcc: CostingAccFields;
  status: RequestStatus;
  currentStepCode: StepCode | null;
  bcItemNo: string | null;
  bcSyncedAt: string | null;
  salesPriceApprovedAt: string | null;
  submittedBy: number | null;
  submittedAt: string | null;
  /** HR snapshot (migration 012) — populated at submit from Rocks_Portal_HR.Employee */
  employeeId?: string | null;
  staffId?: number | null;
  hrBrandId?: number | null;
  requesterFullName?: string | null;
  requesterFullNameTh?: string | null;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  requesterPosition?: string | null;
  requesterDepartmentId?: number | null;
  requesterDepartmentName?: string | null;
  managerStaffId?: number | null;
  companyName?: string | null;
  companyTaxId?: string | null;
  createdAt: string;
  updatedAt: string;
  prices: NiiPriceRow[];
  uoms: NiiUomRow[];
}

/* ── Approval ── */

export type ApprovalAction = "approve" | "revise" | "reject";

export interface NiiApproval {
  id: number;
  requestId: number;
  stepCode: StepCode;
  assignedTo: number | null;
  status: "Pending" | "Approved" | "Rejected" | "Returned" | "Skipped";
  comment: string | null;
  actionedBy: number | null;
  actionedAt: string | null;
  createdAt: string;
}
