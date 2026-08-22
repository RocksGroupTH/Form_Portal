import { isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";

/**
 * Whether the manager-step bypass exists in this process at all.
 *
 * It used to be decided by the request's `Host` header alone: a request
 * arriving with `Host: localhost:3081` let **any** signed-in user approve,
 * reject or return any AP-1 or AP-17 request at the manager step, and the
 * approval was recorded as the assigned manager's. `auth.config.ts` sets
 * `trustHost: true`, so Next takes the header as given, and nothing in the
 * chain guaranteed a deployed reverse proxy would overwrite it — the whole
 * control was a string the client sends.
 *
 * Two conditions now, both required, both server-side:
 *
 *  - the process is not a production build, so a deployed app cannot have it;
 *  - `ACC_MANAGER_DEV_BYPASS=1` is set explicitly. Default-off, so a developer
 *    opts in per machine rather than inheriting it from the port number.
 *
 * Read once at module load: it is a property of the deployment, not of a
 * request, and evaluating it per request invites the same mistake back.
 */
const DEV_BYPASS_AVAILABLE =
  process.env.NODE_ENV !== "production" && process.env.ACC_MANAGER_DEV_BYPASS === "1";

/**
 * True when the manager step may be actioned by any signed-in user.
 *
 * The host is still checked — it keeps the bypass off a dev machine's LAN
 * address — but it is now the narrowest of the three conditions, not the only
 * one.
 */
export function isManagerDevBypassHost(host?: string | null): boolean {
  if (!DEV_BYPASS_AVAILABLE) return false;
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
