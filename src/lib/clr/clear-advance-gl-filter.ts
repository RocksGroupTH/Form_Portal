/** The `DimensionType` values an expense line may charge, given its branch.
 *
 *  HQ takes the head-office accounts; anything else is a branch. "Both" belongs
 *  to each side — those accounts come from the BRANCH dimension too, so a branch
 *  line may charge them (decision: accounting, 2026-09-01).
 *
 *  A line with no branch picked yet is treated as HQ so the list is never empty;
 *  the client keeps the GL picker disabled until a branch is chosen anyway. */
export function allowedDimensionTypes(branchCode: string | null | undefined): readonly string[] {
  return isHqBranch(branchCode) ? ["Employee", "Both"] : ["Branch", "Both"];
}

/** HQ01 and friends are head office; every other branch code is a branch. */
export function isHqBranch(branchCode: string | null | undefined): boolean {
  const b = (branchCode ?? "").trim().toUpperCase();
  return b === "" || b.startsWith("HQ");
}
