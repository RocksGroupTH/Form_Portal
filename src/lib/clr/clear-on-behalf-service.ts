import { findActiveEmployeeByEmail, findColleagueByStaffId } from "@/lib/hr/employee-lookup";
import { CLEAR_ON_BEHALF_ERROR, mayClearFor } from "@/lib/clr/clear-on-behalf";

/**
 * Refuse an AP-3 clearing raised for somebody the actor may not raise one for.
 *
 * Called by **both** routes that take a chosen person — the draft save, which
 * decides whose claim this becomes, and the approved-advance dropdown, which
 * reads that person's money. The second is the reason this exists at all:
 * `resolveRequesterForActor` accepts any active employee, so a `?staffId=` with
 * nothing in front of it would answer for anyone in the company.
 *
 * A blank target means "myself" and is always allowed; that is how every
 * existing AP-3 draft is saved and none of them should pay for this.
 *
 * Not re-asserted at submit. `saveDraft` is the only writer of `StaffId`, and a
 * submit is authorised separately by `authorizeAccRequest` — an admin
 * submitting somebody else's draft would fail a department test that has
 * nothing to do with them.
 */
export async function assertMayClearFor(
  loginEmail: string,
  targetStaffId: number | null | undefined,
): Promise<void> {
  const target = targetStaffId ?? null;
  if (!target) return;

  const { employee: actor } = await findActiveEmployeeByEmail(loginEmail);
  if (!actor) throw new Error("ไม่พบข้อมูลพนักงานของคุณในระบบ HR");
  if (actor.staffId === target) return;

  const colleague = await findColleagueByStaffId(target);
  if (!colleague || !mayClearFor(actor, colleague)) {
    throw new Error(CLEAR_ON_BEHALF_ERROR);
  }
}
