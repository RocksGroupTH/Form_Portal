export const FINAL_SAME_PERSON_ERROR =
  "ขั้นอนุมัติสุดท้ายต้องเป็นคนละคนกับผู้ตรวจสอบในขั้นก่อนหน้า";

/**
 * Whether `candidateStaffId` may take the final step, given who took the
 * accounting check.
 *
 * Refuses when either id is missing. An absent id is not evidence of a different
 * person, and treating it as one is how a two-person rule quietly becomes a
 * one-person rule.
 */
export function canActFinalStep(
  candidateStaffId: number | null | undefined,
  accountStepActorStaffId: number | null | undefined,
): boolean {
  if (candidateStaffId == null || accountStepActorStaffId == null) return false;
  return candidateStaffId !== accountStepActorStaffId;
}
