import type { CSSProperties } from "react";
import type { StepCode } from "@/features/accounting/constants";
import { isAssignedManager } from "@/lib/acc/manager-auth";

export const APPROVAL_STEP_LABEL: Record<StepCode, string> = {
  MANAGER: "ผู้จัดการ",
  ACCOUNT: "บัญชี",
};

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

  const step = (input.pendingStepCode ?? input.currentStepCode) as StepCode | null;
  if (!step || !(step in APPROVAL_STEP_LABEL)) return null;

  if (status === "ManagerApproved" && step === "ACCOUNT" && input.viewerManagerApproved) {
    return "คุณอนุมัติแล้ว · รอบัญชีดำเนินการต่อ";
  }

  const stepLabel = APPROVAL_STEP_LABEL[step as StepCode];
  let actor = input.pendingApproverName?.trim() || input.pendingApproverEmail?.trim() || null;
  if (step === "ACCOUNT" && !actor) actor = "ฝ่ายบัญชี";

  if (actor) return `ลำดับถัดไป: อนุมัติ${stepLabel} · ${actor}`;
  return `ลำดับถัดไป: อนุมัติ${stepLabel}`;
}
