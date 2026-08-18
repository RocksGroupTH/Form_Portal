import type { RequestStatus, StepCode } from "@/features/accounting/constants";
import type { AccApproval, AccFileMeta, PendingFile } from "@/features/accounting/types";

/** โอนให้ — the advance is paid to the requesting employee or to a vendor. */
export type AdvancePayeeType = "employee" | "vendor";

/**
 * AP-2 advance detail — 1:1 with AccRequest (maps to one AccAdvance row).
 * Covers the full Excel AP-2 form: payee (employee/vendor), payee bank, and
 * foreign-currency amount with an exchange rate + THB base amount.
 */
export interface AdvanceDetail {
  /** AccAdvance.Id — present after save/load. */
  id?: number;
  // Payee (โอนให้)
  payeeType: AdvancePayeeType | null;
  payeeName: string | null;         // ชื่อคู่ค้า/พนักงาน (vendor: กรอกเอง; employee: auto)
  payeeBankAccount: string | null;  // เลขที่บัญชี (vendor path)
  payeeBankCode: string | null;     // ธนาคาร → AccBankMaster.BankCode
  // Advance
  needByDate: string | null;        // วันที่ต้องการเริ่มใช้เงิน
  expectedClearDate: string | null; // วันที่คาดว่าจะเคลียร์ (<= needBy + 30 วัน)
  purpose: string | null;           // รายละเอียดค่าใช้จ่าย (free text)
  currency: string;                 // "THB" หรือสกุลต่างประเทศ
  amount: number | null;            // จำนวนเงิน (สกุลที่เลือก)
  exchangeRate: number | null;      // อัตราแลกเปลี่ยน (BOT) — THB=1
  baseAmount: number | null;        // ยอดเป็นบาท = amount × rate (ตัวที่ post journal)
  whtNote: string | null;           // หมายเหตุ WHT (manual — ไม่ post journal)
  overThresholdReason: string | null; // เหตุผลเพิ่มเติมเมื่อยอด > 3,000 บาท
  files?: AccFileMeta[];
  /** Client-only: images chosen but not yet uploaded. */
  pendingFiles?: PendingFile[];
}

/** Payload from the form to saveDraft / submit. */
export interface AdvanceSaveInput {
  id?: number;
  brandCode: string | null;
  staffId: number | null;
  advance: AdvanceDetail;
}

/** Full request for the detail page. Mirrors accounting's AccRequest shape. */
export interface AdvanceRequest {
  id: number;
  requestNo: string | null;
  formCode: string;
  brandCode: string | null;
  status: RequestStatus;
  currentStepCode: string | null; // AP-2 StepType (HEAD_DEPT | HEAD_ACC | DIRECTOR | ACC_OFFICER)
  staffId: number | null;
  requesterFullName: string | null;
  requesterEmail: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  requesterDepartmentCode: string | null;
  managerStaffId: number | null;
  managerEmail: string | null;
  companyName: string | null;
  totalAmount: number | null;
  paymentDate: string | null;
  submittedBy: number | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  advance?: AdvanceDetail;
  approvals?: AdvanceApprovalRow[];
}

/** One row of AP-2's own approval chain (AccAdvanceApproval). */
export interface AdvanceApprovalRow {
  id: number;
  stepOrder: number;
  stepType: string;
  stepLabel: string;
  status: string;
  comment: string | null;
  isChecked: boolean | null;
  paymentDate: string | null;
  actionedByStaffId: number | null;
  actionedByName: string | null;
  assignedName: string | null;
  actionedAt: string | null;
}

/** Lightweight row for the draft picker (no files). */
export interface AdvanceDraftSummary {
  id: number;
  brandCode: string | null;
  status: RequestStatus;
  needByDate: string | null;
  expectedClearDate: string | null;
  purpose: string | null;
  amount: number | null;
  updatedAt: string;
}
