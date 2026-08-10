import { isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";

/** True on local dev hosts where manager approval can be actioned by any logged-in user. */
export function isManagerDevBypassHost(host?: string | null): boolean {
  return isErpSandboxHostAllowed(host);
}

/** True when the actor's HR StaffId matches the manager assigned on the request (HR snapshot). */
export function isAssignedManager(
  actorStaffId: number | null | undefined,
  requestManagerStaffId: number | null | undefined,
): boolean {
  return (
    actorStaffId != null &&
    requestManagerStaffId != null &&
    actorStaffId === requestManagerStaffId
  );
}

/** True when the actor may action the pending MANAGER approval step. */
export function canActManagerStep(
  actorStaffId: number | null | undefined,
  actorEmail: string | null | undefined,
  requestManagerStaffId: number | null | undefined,
  managerApproval: {
    assignedTo: number | null;
    assignedEmail: string | null;
    status: string;
  } | null | undefined,
  viewerRole?: string | null,
  devHostBypass = false,
): boolean {
  if (managerApproval && managerApproval.status !== "Pending") return false;
  if (devHostBypass) return true;
  if (isAssignedManager(actorStaffId, requestManagerStaffId)) return true;
  if (actorStaffId != null && managerApproval?.assignedTo === actorStaffId) return true;
  const actor = actorEmail?.trim().toLowerCase();
  const assigned = managerApproval?.assignedEmail?.trim().toLowerCase();
  if (actor && assigned && actor === assigned) return true;
  return false;
}

export function canActManagerApi(
  actorStaffId: number | null | undefined,
  requestManagerStaffId: number | null | undefined,
  _role: string | null | undefined,
  host?: string | null,
  managerApproval?: {
    assignedTo: number | null;
    assignedEmail: string | null;
    status: string;
  } | null,
  actorEmail?: string | null,
): boolean {
  return canActManagerStep(
    actorStaffId,
    actorEmail ?? null,
    requestManagerStaffId,
    managerApproval,
    null,
    isManagerDevBypassHost(host),
  );
}

export const MANAGER_AUTH_ERROR =
  "ไม่มีสิทธิ์ — คุณไม่ใช่ผู้จัดการที่ HR มอบหมายสำหรับคำขอนี้";
