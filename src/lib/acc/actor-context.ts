import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { listApprovers } from "@/lib/acc/settings-service";
import { isSystemAdminRole } from "@/lib/roles";
import type { Actor } from "@/lib/acc/approval-engine";

/** Build actor for approval actions — resolves HR StaffId from Employee, then AccApprover fallback. */
export async function buildAccActor(userId: number, email: string | null): Promise<Actor> {
  let staffId: number | null = null;

  if (email?.trim()) {
    const emp = await findActiveEmployeeByEmail(email.trim());
    staffId = emp?.employee?.staffId ?? null;

    if (staffId == null) {
      const norm = email.trim().toLowerCase();
      const approvers = await listApprovers(true);
      const match = approvers.find((a) => a.email.toLowerCase() === norm);
      staffId = match?.staffId ?? null;
    }
  }

  return {
    userId,
    email: email?.trim() || null,
    staffId,
  };
}

/** Require HR StaffId before writing AccApproval.ActionedByStaffId. */
export function requireActorStaffId(actor: { staffId: number | null }): number {
  if (actor.staffId == null) {
    throw new Error("ไม่พบ StaffId ในระบบ HR — ไม่สามารถดำเนินการได้");
  }
  return actor.staffId;
}

/** System Admin without HR StaffId may action using a step-specific fallback. */
export async function resolveAccActorForAction(
  actor: Actor,
  role: string | null | undefined,
  fallbackStaffId: number | null | undefined,
): Promise<Actor> {
  if (actor.staffId != null) return actor;
  if (!isSystemAdminRole(role)) return actor;
  if (fallbackStaffId != null) return { ...actor, staffId: fallbackStaffId };
  const approvers = await listApprovers(true);
  for (let i = 0; i < approvers.length; i++) {
    const sid = approvers[i].staffId;
    if (sid != null) return { ...actor, staffId: sid };
  }
  return actor;
}
