/**
 * AP-11 wire shapes — what the API returns and the client renders.
 *
 * Kept free of server imports so client components can use them directly.
 * Database columns are PascalCase; everything here is camelCase, per the repo
 * convention.
 */

export type RewardRequestStatus =
  | "Draft"
  | "Submitted"
  | "ManagerApproved"
  | "Approved"
  | "Ready"
  | "Received"
  | "Rejected"
  | "Returned";

/** A row of the reward catalogue, with its three derived numbers already applied. */
export interface RewardOption {
  id: number;
  brandCode: string;
  code: string;
  name: string;

  qty: number;
  lockedQty: number;
  issuedQty: number;
  /** brief §4 — locked + issued. */
  requestQty: number;
  /** brief §5. */
  expiredQty: number;
  /** brief §6 — what may still be asked for. The cap on the quantity input. */
  balanceQty: number;

  unitActualValue: number | null;
  unitBookValue: number | null;
  totalActualValue: number | null;
  totalBookValue: number | null;

  startDate: string | null;
  expireDate: string | null;
  poNo: string | null;
  pinNo: string | null;
  prepaymentNo: string | null;

  isActive: boolean;
  sortOrder: number;
  /** Derived: active, started, unexpired and non-empty. Drives the card list. */
  selectable: boolean;
}

/** What the settings page writes. Counters are absent — nobody types those. */
export interface RewardUpsertInput {
  id?: number;
  brandCode: string;
  code: string;
  name: string;
  qty: number;
  unitActualValue: number | null;
  unitBookValue: number | null;
  startDate: string | null;
  expireDate: string | null;
  poNo: string | null;
  pinNo: string | null;
  prepaymentNo: string | null;
  isActive: boolean;
  sortOrder?: number;
}

/** An Assist AP roster entry. */
export interface RewardOfficer {
  id: number;
  staffId: number | null;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  isActive: boolean;
}

export interface RewardAttachment {
  id: number;
  fileName: string;
  fileSize: number | null;
  contentType: string | null;
  uploadedAt: string;
}

export interface RewardTimelineEntry {
  id: number;
  action: string;
  note: string | null;
  authorName: string | null;
  createdAt: string;
}

export interface RewardApprovalRow {
  stepCode: string;
  stepOrder: number;
  status: string;
  /**
   * The StaffId the step was assigned to. Carried so the detail page can apply
   * the same `canActManagerStep` rule the server applies, instead of
   * approximating it from `assignedEmail` alone.
   */
  assignedTo: number | null;
  assignedEmail: string | null;
  actionedByStaffId: number | null;
  actionedAt: string | null;
  comment: string | null;
}

/** The full request, as the detail page and the queue read it. */
export interface RewardRequest {
  id: number;
  requestNo: string | null;
  formCode: string;
  brandCode: string | null;
  status: RewardRequestStatus;
  currentStepCode: string | null;

  staffId: number | null;
  requesterFullName: string | null;
  requesterEmail: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  managerStaffId: number | null;
  managerEmail: string | null;
  companyName: string | null;

  rewardId: number | null;
  rewardCode: string | null;
  rewardName: string | null;
  unitActualValue: number | null;
  unitBookValue: number | null;
  qty: number;
  note: string | null;
  /** qty × unitActualValue, computed server-side so the client never re-derives money. */
  totalActualValue: number | null;

  readyAt: string | null;
  readyByName: string | null;
  receivedAt: string | null;
  receivedByName: string | null;

  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;

  attachments: RewardAttachment[];
  approvals: RewardApprovalRow[];
  timeline: RewardTimelineEntry[];
}

/** One line of the Assist AP queue or the report. */
export interface RewardListRow {
  id: number;
  requestNo: string | null;
  status: RewardRequestStatus;
  brandCode: string | null;
  requesterFullName: string | null;
  requesterDepartmentName: string | null;
  staffId: number | null;
  rewardCode: string | null;
  rewardName: string | null;
  qty: number;
  totalActualValue: number | null;
  submittedAt: string | null;
  readyAt: string | null;
  receivedAt: string | null;
  /** Last touched — what Home sorts its "continue where you left off" strip by. */
  updatedAt: string | null;
  /** 'Production' | 'UAT' — present on merged lists so a row names its database. */
  environment?: string;
}
