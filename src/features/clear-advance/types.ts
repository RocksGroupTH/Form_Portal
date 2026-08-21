import type { RequestStatus } from "@/features/accounting/constants";
import type { AccFileMeta, PendingFile } from "@/features/accounting/types";
import type { ClrStepCode } from "./constants";

/** One actual-expense line (AP-3.1 section 1). */
export interface ClearAdvanceItem {
  /** AccClearAdvanceItem.Id — present after save/load. */
  id?: number;
  lineNo: number;                 // ลำดับที่
  expenseDate: string | null;     // วันที่
  docNo: string | null;           // เลขที่เอกสาร
  glAccountNo: string | null;     // รายการ → AP-3.2 G/L
  glAccountName: string | null;   // snapshot ชื่อบัญชี
  description: string | null;     // รายละเอียด
  branchCode: string | null;      // สาขา (BU/Branch dimension)
  amountBeforeVat: number | null; // ค่าใช้จ่าย (ยอดก่อน VAT)
  vatAmount: number | null;       // ภาษีมูลค่าเพิ่ม (VAT)
  totalInclVat: number | null;    // ค่าใช้จ่ายรวม (auto = before + VAT)
  whtAmount: number | null;       // ภาษีหัก ณ ที่จ่าย (ถ้ามี)
  netAmount: number | null;       // จำนวนจ่ายสุทธิ (auto = total − WHT)
  sortOrder?: number;
  /** AccRequestFile.Id this line was OCR-filled from — cleared with its receipt. */
  sourceFileId?: number | null;
}

/** One WHT-certificate line (AP-3.1 section 2) — required when a line has WHT. */
export interface ClearAdvanceWhtItem {
  id?: number;
  lineNo: number;
  expenseDate: string | null;
  docNo: string | null;
  description: string | null;
  taxId: string | null;        // เลขที่ผู้เสียภาษี (user fills)
  payeeName: string | null;    // ชื่อ-สกุล/ชื่อบริษัท (user fills)
  payeeAddress: string | null; // ที่อยู่ (user fills)
  amount: number | null;       // ค่าใช้จ่าย
  whtAmount: number | null;    // ภาษีหัก ณ ที่จ่าย
  netAmount: number | null;    // จำนวนจ่ายสุทธิ
  sortOrder?: number;
}

/**
 * AP-3 clear-advance detail — 1:1 with AccRequest. Faithful to AP-3.1: an expense
 * ledger with G/L category, VAT, WHT, branch dimension and a running balance.
 * Phase 1: currency always THB, no ERP auto-post.
 */
export interface ClearAdvanceDetail {
  id?: number;
  advanceRequestId: number | null; // the AP-2 AccRequest being cleared
  advanceRequestNo: string | null; // snapshot RPC-ADVyy-xxxx
  advanceAmount: number | null;    // snapshot วงเงินที่ได้รับ (starting balance)
  expenseOf: string | null;        // Rocks PC / Rocks Malaysia
  actualTotal: number | null;      // Σ items.netAmount (auto)
  refundToCompany: number | null;  // advanceAmount − actualTotal (บวก = คืนบริษัท, ลบ = จ่ายเพิ่ม)
  currency: string;                // Phase 1: always "THB"
  whtNote: string | null;
  refundTransferDate: string | null;   // วันที่โอนเงินคืน (default จาก OCR สลิป)
  refundTransferAmount: number | null; // ยอดที่โอนคืนจริง (default จาก OCR สลิป, แก้ไขได้)
  pvDocNo: string | null;             // เลขที่ PV/PPEX (Account step)
  paymentDate: string | null;         // วันจ่าย ศุกร์ (Account step, only when company pays extra)
  items: ClearAdvanceItem[];
  whtItems: ClearAdvanceWhtItem[];
  files?: AccFileMeta[];              // receipts / tax invoices
  refundProofFiles?: AccFileMeta[];   // หลักฐานการโอนเงินคืน
  /** Client-only: images chosen but not yet uploaded. */
  pendingFiles?: PendingFile[];
}

/** Payload from the form to saveDraft / submit. */
export interface ClearAdvanceSaveInput {
  id?: number;
  brandCode: string | null;
  staffId: number | null;
  clear: ClearAdvanceDetail;
}

/** One approval-chain row for the detail page. */
export interface ClrApproval {
  id: number;
  stepCode: ClrStepCode;
  stepOrder: number;
  stepLabel: string;
  assignedStaffId: number | null;
  assignedEmail: string | null;
  status: string; // Pending | Approved | Rejected | Returned
  comment: string | null;
  isChecked: boolean | null;
  actionedByStaffId: number | null;
  actionedByName: string | null;
  assignedName: string | null;
  actionedAt: string | null;
  createdAt: string;
}

/** Full request for the detail page. */
export interface ClearAdvanceRequest {
  id: number;
  requestNo: string | null;
  formCode: string;
  brandCode: string | null;
  status: RequestStatus;
  currentStepCode: ClrStepCode | null;
  staffId: number | null;
  requesterFullName: string | null;
  requesterEmail: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  requesterDepartmentCode: string | null;
  managerStaffId: number | null;
  managerEmail: string | null;
  companyName: string | null;
  totalAmount: number | null; // mirrors actualTotal
  submittedBy: number | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clear?: ClearAdvanceDetail;
  approvals?: ClrApproval[];
}

/** Lightweight row for the draft picker. */
export interface ClearAdvanceDraftSummary {
  id: number;
  brandCode: string | null;
  status: RequestStatus;
  advanceRequestNo: string | null;
  advanceAmount: number | null;
  actualTotal: number | null;
  refundToCompany: number | null;
  updatedAt: string;
}

/** A pending AP-2 advance available to clear (dropdown option). */
export interface PendingAdvanceOption {
  advanceRequestId: number;
  /** Advance amount in THB (BaseAmount) — already currency-converted. */
  advanceAmount: number | null;
  advanceRequestNo: string | null;
  needByDate: string | null;
  purpose: string | null;
  /** Original currency of the advance (e.g. "USD"); null/"THB" = no conversion. */
  currency: string | null;
  /** Original amount in that currency, before conversion to THB. */
  origAmount: number | null;
  /** FX rate used to convert to THB (origAmount × exchangeRate = advanceAmount). */
  exchangeRate: number | null;
}

/** AP-3.2 G/L expense-category master option (dropdown for a line's รายการ). */
export interface GlAccountOption {
  glAccountNo: string;
  nameTh: string | null;
  nameEn: string | null;
  dimensionType: "Employee" | "Branch" | "Both";
}

/** Branch/BU dimension option for a line's สาขา. */
export interface BranchOption {
  code: string;
  name: string | null;
}
