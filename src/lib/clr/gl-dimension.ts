/**
 * AP-3.2 — the two dimension checkboxes on a G/L category, and the one value
 * they are stored as.
 *
 * `AccClearAdvanceGlCompany.DimensionType` holds `Employee`, `Branch` or
 * `Both`; the settings screen shows a box for each dimension. They are the same
 * fact in two shapes, so the mapping lives here once rather than inline in the
 * panel, and `gl-dimension.test.ts` pins the round trip in both directions.
 *
 * **There is deliberately no value for "neither".** A category nobody may
 * charge is `IsActive = 0`, not a row with an empty dimension — which is what
 * turns "at least one dimension" from a check somebody has to remember into a
 * property of the storage. `nextDimension` is therefore allowed to refuse, and
 * the one thing it refuses is unticking the last box.
 *
 * Pure and import-free.
 */

export type DimensionType = "Employee" | "Branch" | "Both";

export const DIMENSION_TYPES: readonly DimensionType[] = ["Employee", "Branch", "Both"];

/** Which box is which. `kind` is what a click names. */
export type DimensionKind = "branch" | "employee";

export interface DimensionChecks {
  branch: boolean;
  employee: boolean;
}

export const DIMENSION_REQUIRED_ERROR =
  "ต้องเลือก Dimension อย่างน้อย 1 อย่าง — ถ้าไม่ต้องการหมวดนี้แล้วให้ติ๊ก “ใช้งาน” ออกแทน";

/** The stored value for a tick pair, or `null` when neither is ticked. */
export function dimensionFromChecks(checks: DimensionChecks): DimensionType | null {
  if (checks.branch && checks.employee) return "Both";
  if (checks.branch) return "Branch";
  if (checks.employee) return "Employee";
  return null;
}

/** The tick pair for a stored value. `Both` is both boxes, not a third box. */
export function dimensionChecks(dimensionType: DimensionType): DimensionChecks {
  return {
    branch: dimensionType === "Branch" || dimensionType === "Both",
    employee: dimensionType === "Employee" || dimensionType === "Both",
  };
}

export interface DimensionChange {
  /** The value to store, or `null` when the click is refused. */
  dimensionType: DimensionType | null;
  /** Why it was refused, or `null`. Never both null and a value. */
  error: string | null;
}

/**
 * What one click on one box means.
 *
 * Returns the new stored value, or refuses — and the only refusal is unticking
 * the last box, because the column has nothing to hold that state and because
 * a category with no dimension is not a thing anybody wants: they want it off.
 */
export function nextDimension(
  /**
   * What the row stores now, or `null` where this company has no rule for the
   * account yet — most rows, since the screen lists the whole chart of
   * accounts. It has to reach here as null: substituting a pretend value at
   * the call site makes ONE tick answer `Both`, silently ticking the box
   * nobody clicked on the setting that decides what a line must carry.
   */
  current: DimensionType | null,
  kind: DimensionKind,
  checked: boolean,
): DimensionChange {
  const base: DimensionChecks = current ? dimensionChecks(current) : { branch: false, employee: false };
  const next = { ...base, [kind]: checked } as DimensionChecks;
  const dimensionType = dimensionFromChecks(next);
  return dimensionType === null
    ? { dimensionType: null, error: DIMENSION_REQUIRED_ERROR }
    : { dimensionType, error: null };
}

/** Narrow an untrusted string, for the write path. */
export function isDimensionType(v: unknown): v is DimensionType {
  return typeof v === "string" && (DIMENSION_TYPES as readonly string[]).indexOf(v) !== -1;
}
