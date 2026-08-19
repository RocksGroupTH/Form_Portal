/**
 * AP-4 — Staff Reimbursement. camelCase shapes mirroring `AccRequest` +
 * `AccReimburse` / `AccReimburseItem` / `AccReimburseRuleAck` (migration 088–090)
 * plus the shared `AccApproval`. See
 * docs/superpowers/specs/2026-08-19-ap-4-staff-reimbursement-design.md §2, §5.
 */
import type { ReimburseStatus, ReimburseStepCode } from "./constants";

/** One expense line (`AccReimburseItem`). */
export interface ReimburseItem {
  /** AccReimburseItem.Id — present after save/load, absent for a row not yet persisted. */
  id?: number;
  sortOrder: number;
  /** YYYY-MM-DD. NOT NULL in the database — a row without one is not yet a real row (see request-service.ts). */
  expenseDate: string | null;
  description: string;
  /** VAT-inclusive. */
  amount: number;
  vatAmount?: number | null;
  /** Withholding tax, where the service exceeded 1,000 THB. */
  whtAmount?: number | null;
}

/** File attached to a request (`AccRequestFile`), request-level (spec §5.2 fields 4b/5). */
export interface ReimburseFileMeta {
  id: number;
  fileName: string;
  fileSize: number | null;
  contentType: string | null;
  url: string;
}

/** One approval step instance against the shared `AccApproval` table. */
export interface ReimburseApproval {
  id: number;
  requestId: number;
  stepCode: ReimburseStepCode;
  stepOrder: number;
  /** HR Employee.StaffId of the assigned approver. */
  assignedTo: number | null;
  assignedEmail: string | null;
  status: "Pending" | "Approved" | "Rejected" | "Returned";
  comment: string | null;
  isChecked: boolean | null;
  /** HR Employee.StaffId of the person who actioned this step. */
  actionedByStaffId: number | null;
  actionedAt: string | null;
  createdAt: string;
  actionedByHrName?: string | null;
  actionedByHrEmail?: string | null;
  assignedToHrName?: string | null;
  assignedToHrEmail?: string | null;
}

/** Full request: `AccRequest` header ⋈ `AccReimburse` detail, plus items, rule acks, attachments and approvals. */
export interface ReimburseDetail {
  id: number;
  requestNo: string | null;
  formCode: string;
  brandCode: string | null;
  status: ReimburseStatus;
  currentStepCode: ReimburseStepCode | null;
  staffId: number | null;
  requesterFullName: string | null;
  requesterEmail: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  managerStaffId: number | null;
  managerEmail: string | null;
  companyName: string | null;
  /** What the spend was for — free text, optional (spec §2.1). */
  purpose: string | null;
  /** VAT-inclusive sum of `items`, recomputed server-side at submit — never trust the client's figure. */
  totalAmount: number | null;
  paymentDate: string | null;
  submittedBy: number | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Expense lines, ordered by SortOrder. */
  items: ReimburseItem[];
  /** AccReimburseRule.Id values ticked for this request (spec §5.2 field 6). */
  ackedRuleIds: number[];
  /** The AP-4.1 workbook (spec §5.2 field 4b) — one, or none yet. */
  excelFile: ReimburseFileMeta | null;
  /** Receipts / tax invoices (spec §5.2 field 5) — many. */
  receiptFiles: ReimburseFileMeta[];
  approvals?: ReimburseApproval[];
}

/**
 * What `saveReimburseDraft` accepts. AP-4 has no on-behalf submission (unlike
 * AP-1/AP-17 — spec §5.2 fields 1–2 are always the signed-in user's own HR
 * record), so unlike AP-1's `SaveInput` there is no `requesterStaffId`.
 */
export interface SaveInput {
  /** AccRequest.Id — present when updating an existing draft. */
  id?: number;
  brandCode: string | null;
  purpose: string | null;
  items: ReimburseItem[];
  /** Rule ids ticked so far (spec §5.2 field 6) — replaced wholesale on every save. */
  ackedRuleIds: number[];
}

/** `AccReimburseRule` row — one line of the acknowledgement checklist. */
export interface ReimburseRule {
  id: number;
  ruleText: string;
  sortOrder: number;
  isActive: boolean;
}

/** `AccReimburseApprover` row — a member of AP-4's accounting-approver pool (covers both ACCOUNT and ACCOUNT_FINAL). */
export interface ReimburseApprover {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
}
