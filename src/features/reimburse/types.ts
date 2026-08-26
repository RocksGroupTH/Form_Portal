/**
 * AP-4 — Staff Reimbursement. camelCase shapes mirroring `AccRequest` +
 * `AccReimburse` / `AccReimburseItem` / `AccReimburseRuleAck` (migration 088–090)
 * plus the shared `AccApproval`. See
 * docs/superpowers/specs/2026-08-19-ap-4-staff-reimbursement-design.md §2, §5.
 */
import type { ReimburseStatus, ReimburseStepCode } from "./constants";

/** One line as printed inside an attached document (`AccReimburseItemDetail`). */
export interface ReimburseItemDetail {
  sortOrder: number;
  /** NOT NULL in the database — a line with no description is dropped before it gets here. */
  description: string;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
}

/** One expense line (`AccReimburseItem`). */
export interface ReimburseItem {
  /** AccReimburseItem.Id — present after save/load, absent for a row not yet persisted. */
  id?: number;
  sortOrder: number;
  /** YYYY-MM-DD. Nullable only while the grid row is still being typed: NOT NULL in the database, and a row with any other content but no date is refused at save (see lib/acc/reimburse/item-money.ts). */
  expenseDate: string | null;
  /** เลขที่เอกสาร — the receipt or tax-invoice number. Migration 117. */
  documentNo?: string | null;
  /** รายการ — the expense category, e.g. "AP-4.2". Free text; there is no master list. Migration 117. */
  category?: string | null;
  /** สาขา — the branch the expense belongs to. Migration 117. */
  branchName?: string | null;
  /**
   * เลขประจำตัวผู้เสียภาษี of the seller, digits only. Migration 118.
   *
   * A string, not a number: it leads with a zero, arithmetic on it is
   * meaningless, and the stored form is stripped of the grouping documents
   * print so a value cannot vary by punctuation.
   */
  vendorTaxId?: string | null;
  /** ชื่อ-สกุล / ชื่อบริษัท of the seller. Migration 118. */
  vendorName?: string | null;
  /** ที่อยู่ of the seller. Migration 118. */
  vendorAddress?: string | null;
  /**
   * `AccRequestFile.Id` of the attachment this row was read from, or null for a
   * row typed by hand. Migration 119.
   *
   * Deleting that attachment deletes this row. Not a foreign key — see the
   * migration; a dangling id means "the document is gone", which is what the
   * form then shows.
   */
  sourceFileId?: number | null;
  /**
   * **UI only, never persisted.** The `PendingDocument.localId` this row came
   * from, which is the only link that exists before the file has been uploaded
   * and given an id. The save swaps it for `sourceFileId` once the upload
   * answers, and the server never sees it.
   */
  sourceDocId?: string | null;
  /**
   * The lines printed inside the attached document — what the quotation or tax
   * invoice itemises under this one charge (`AccReimburseItemDetail`,
   * migration 121).
   *
   * A transcription, never a second source of truth: nothing sums it, and
   * `amount` above stays what the claim is worth. Absent on a row typed by
   * hand and on a row read from a document that itemises nothing.
   */
  details?: ReimburseItemDetail[];
  description: string;
  /**
   * **VAT-inclusive** — ค่าใช้จ่ายรวม in the AP-4.1 sheet, and the only money
   * column stored besides the two below.
   *
   * ใช้จ่ายก่อนภาษีมูลค่าเพิ่ม and จำนวนจ่ายสุทธิ are both derived rather than
   * stored (`amount - vatAmount` and `amount - whtAmount`), so there is exactly
   * one authority for what a line costs. Storing all five would let a rounding
   * difference put two of them at odds with no way to tell which is right.
   */
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
 * What `saveReimburseDraft` accepts.
 *
 * The spec (§5.2 fields 1–2) had this form always naming the signed-in user's
 * own HR record, and it did until 2026-08-24, when on-behalf submission was
 * asked for on every form rather than on AP-1 and AP-17 only. The reach that
 * gives is the same the other two forms have always had — anyone may file for
 * any active employee, and it routes to *that* person's manager — which was
 * raised and accepted rather than narrowed for AP-4 alone.
 */
export interface SaveInput {
  /** AccRequest.Id — present when updating an existing draft. */
  id?: number;
  brandCode: string | null;
  purpose: string | null;
  items: ReimburseItem[];
  /** Rule ids ticked so far (spec §5.2 field 6) — replaced wholesale on every save. */
  ackedRuleIds: number[];
  /** ผู้ขอเบิก when filing for a colleague (their HR StaffId); null/absent = self. */
  requesterStaffId?: number | null;
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
