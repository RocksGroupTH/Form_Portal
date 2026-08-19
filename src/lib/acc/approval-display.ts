import type { CSSProperties } from "react";
import type { StepCode } from "@/features/accounting/constants";
import { isAssignedManager } from "@/lib/acc/manager-auth";

export const APPROVAL_STEP_LABEL: Record<StepCode, string> = {
  MANAGER: "ผู้จัดการ",
  ACCOUNT: "บัญชี",
};

/**
 * Every step this module can label, AP-4's third one included.
 *
 * `APPROVAL_STEP_LABEL` is typed `Record<StepCode, string>` and `StepCode` is
 * AP-1's two-value union, so `ACCOUNT_FINAL` cannot go in it without widening a
 * type two other forms depend on. It is added here instead, and the effect is
 * the one that was missing: an AP-4 row sitting at its final approval used to
 * fall through `!(step in APPROVAL_STEP_LABEL)` and render no "ลำดับถัดไป" line
 * at all in My Work — the one place the list is supposed to say what it is
 * waiting for.
 */
const STEP_LABEL: Record<string, string> = {
  ...APPROVAL_STEP_LABEL,
  ACCOUNT_FINAL: "บัญชี (ขั้นสุดท้าย)",
};

/** True for the steps whose assignee is a pool rather than one named person. */
function isAccountingStep(step: string): boolean {
  return step === "ACCOUNT" || step === "ACCOUNT_FINAL";
}

export interface NextApprovalInput {
  status: string;
  currentStepCode?: string | null;
  pendingStepCode?: string | null;
  pendingApproverName?: string | null;
  pendingApproverEmail?: string | null;
}

export interface MyWorkViewerContext {
  staffId: number | null;
  email: string | null;
  isAccountApprover: boolean;
}

/** My Work list bucket — relative to the signed-in approver, not raw request status. */
export type MyWorkStatusBucket =
  | "pending"
  | "Approved"
  | "Rejected"
  | "Returned"
  | "Cancelled";

export interface MyWorkRowInput extends NextApprovalInput {
  managerStaffId?: number | null;
  managerEmail?: string | null;
  viewerManagerApproved?: boolean;
  /** Which form the row belongs to — AP-4's accounting steps bucket differently. */
  formCode?: string | null;
}

function viewerIsRequestManager(
  row: MyWorkRowInput,
  viewer: MyWorkViewerContext,
): boolean {
  if (isAssignedManager(viewer.staffId, row.managerStaffId ?? null)) return true;
  const email = viewer.email?.trim().toLowerCase();
  const mgr = row.managerEmail?.trim().toLowerCase();
  return !!(email && mgr && email === mgr);
}

/**
 * Classify a row for My Work filters/summary.
 * Manager-approved requests leave "รออนุมัติ" for the assigned manager;
 * account approvers (who are not that manager) still see them as pending until they act.
 */
export function getMyWorkStatusBucket(
  row: MyWorkRowInput,
  viewer: MyWorkViewerContext,
): MyWorkStatusBucket {
  const { status } = row;
  if (status === "Rejected") return "Rejected";
  if (status === "Returned") return "Returned";
  if (status === "Cancelled") return "Cancelled";
  if (status === "Approved") return "Approved";

  const pending = row.pendingStepCode ?? row.currentStepCode ?? null;

  if (status === "Submitted" && pending === "MANAGER") {
    return "pending";
  }

  if (status === "ManagerApproved") {
    if (row.viewerManagerApproved || viewerIsRequestManager(row, viewer)) {
      return "Approved";
    }
    // AP-4 answers to its own approver pool (`AccReimburseApprover`), not the
    // `AccApprover` roster `viewer.isAccountApprover` reports on, and it has two
    // accounting steps rather than one. `listMyWorkRows` hands a viewer an AP-4
    // row with a pending accounting step only when they are on that pool, so the
    // list query is the authority here — the same way `viewerManagerApproved`
    // above is trusted rather than recomputed. Inert for the other two forms:
    // neither is FormCode 'AP-4', and neither ever produces ACCOUNT_FINAL.
    if (
      row.formCode === "AP-4" &&
      (pending === "ACCOUNT" || pending === "ACCOUNT_FINAL")
    ) {
      return "pending";
    }
    if (pending === "ACCOUNT" && viewer.isAccountApprover) {
      return "pending";
    }
    return "Approved";
  }

  return "pending";
}

export function myWorkStatusLabel(bucket: MyWorkStatusBucket): string {
  switch (bucket) {
    case "pending":
      return "รออนุมัติ";
    case "Approved":
      return "อนุมัติแล้ว";
    case "Rejected":
      return "ไม่อนุมัติ";
    case "Returned":
      return "ส่งกลับแก้ไข";
    case "Cancelled":
      return "ยกเลิก";
    default:
      return bucket;
  }
}

export function myWorkStatusStyle(bucket: MyWorkStatusBucket): CSSProperties {
  switch (bucket) {
    case "Approved":
      return {
        background: "var(--bg-info-green)",
        color: "var(--text-info-green)",
        border: "1px solid var(--border-info-green)",
      };
    case "pending":
      return {
        background: "var(--bg-info-yellow)",
        color: "var(--text-info-yellow)",
        border: "1px solid var(--border-info-yellow)",
      };
    case "Returned":
      return {
        background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
        color: "var(--color-warning)",
        border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
      };
    case "Rejected":
    case "Cancelled":
      return {
        background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
        color: "var(--color-danger)",
        border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
      };
    default:
      return {
        background: "var(--bg-badge)",
        color: "var(--text-muted)",
        border: "1px solid var(--border-light)",
      };
  }
}

/** Short label for list rows — next approval step and assignee when in progress. */
export function formatNextApprovalDetail(input: NextApprovalInput & { viewerManagerApproved?: boolean }): string | null {
  const { status } = input;
  if (status === "Approved" || status === "Rejected" || status === "Cancelled" || status === "Draft") {
    return null;
  }
  if (status === "Returned") {
    return "ลำดับถัดไป: แก้ไขและส่งคำขอใหม่";
  }

  const step = input.pendingStepCode ?? input.currentStepCode ?? null;
  if (!step || !(step in STEP_LABEL)) return null;

  if (status === "ManagerApproved" && isAccountingStep(step) && input.viewerManagerApproved) {
    return "คุณอนุมัติแล้ว · รอบัญชีดำเนินการต่อ";
  }

  const stepLabel = STEP_LABEL[step];
  let actor = input.pendingApproverName?.trim() || input.pendingApproverEmail?.trim() || null;
  // Both accounting steps are assigned to a pool, not a person, so "ฝ่ายบัญชี"
  // is the honest name for whoever is next when no row names one.
  if (isAccountingStep(step) && !actor) actor = "ฝ่ายบัญชี";

  if (actor) return `ลำดับถัดไป: อนุมัติ${stepLabel} · ${actor}`;
  return `ลำดับถัดไป: อนุมัติ${stepLabel}`;
}
