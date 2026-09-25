/**
 * Who a person may raise an AP-3 clearing for.
 *
 * The picker offers the actor plus their own department, the same set AP-2's
 * on-behalf picker offers. **This is the check behind that list, not a copy of
 * it**: `resolveRequesterForActor` deliberately accepts any active employee
 * ("Widening this was asked for directly"), so without a check of its own the
 * picker would be presentation and nothing more.
 *
 * That matters more on AP-3 than it does on AP-2, because AP-3 has a second
 * route that takes the chosen person: the dropdown of approved AP-2 advances
 * they may clear. Left ungated, `?staffId=` would let any signed-in user read
 * anybody's approved advances — number, amount, purpose and payee. AP-2 never
 * had that exposure because nothing on its form fetches another person's data.
 *
 * Pure, so the rule is tested without a database; the caller looks both people
 * up and hands their departments in.
 */

export interface ClearOnBehalfPerson {
  staffId?: number | null;
  departmentId?: number | null;
}

export function mayClearFor(
  actor: ClearOnBehalfPerson,
  target: ClearOnBehalfPerson,
): boolean {
  const actorStaff = actor.staffId ?? null;
  const targetStaff = target.staffId ?? null;
  if (actorStaff == null || targetStaff == null) return false;

  // Yourself, always — this is the ordinary case, and it must not depend on
  // HR having a department on file.
  if (actorStaff === targetStaff) return true;

  // Somebody else: same department, and the department has to be a real one.
  // A null on either side is not a match. Two employees whose department HR has
  // not filled in are not thereby colleagues, and treating them as such would
  // make every incomplete record a hole in this rule.
  const actorDept = actor.departmentId ?? null;
  const targetDept = target.departmentId ?? null;
  if (actorDept == null || targetDept == null) return false;

  return actorDept === targetDept;
}

/** What the refusal says. One spelling, so the route and the service agree. */
export const CLEAR_ON_BEHALF_ERROR =
  "เคลียร์แทนได้เฉพาะตัวเองหรือเพื่อนร่วมแผนกเดียวกัน";
