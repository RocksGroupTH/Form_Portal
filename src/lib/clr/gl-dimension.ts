/**
 * AP-3.2 — the two dimension checkboxes on a G/L category, and the one value
 * they are stored as.
 *
 * `AccClearAdvanceGlCompany.DimensionType` holds `Employee`, `Branch` or
 * `Both`; the settings screen shows a box for each dimension. They are the same
 * fact in two shapes, so the mapping lives here once rather than inline in the
 * panel, and `gl-dimension.test.ts` pins the round trip in both directions.
 *
 * **There is deliberately no value for "neither", and unticking the last box
 * is not refused — it CLEARS the company's rule.** The column has nothing to
 * hold "no dimension", but the screen has always had a state for it: an account
 * this company has no rule row for, which reads "ยังไม่ได้ตั้งค่า". So the last
 * untick returns the account to exactly where it was before anybody touched it,
 * and `nextDimension` answers `{ kind: "clear" }` rather than an error.
 *
 * It refused at first, on the reasoning that "at least one dimension" should be
 * a property of the storage. That was true and it was still wrong: a row ticked
 * by mistake had **no way back at all** — `ใช้งาน` only switches a rule off, it
 * does not remove one — and the user said so (2026-09-14).
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

/**
 * What a click resolves to. A discriminated union rather than a nullable value,
 * so "store this" and "remove the rule" cannot be confused for one another by a
 * caller that only checks for null.
 */
export type DimensionChange =
  | { kind: "set"; dimensionType: DimensionType }
  | { kind: "clear" };

/**
 * What one click on one box means: the new stored value, or clear the rule.
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
  return dimensionType === null ? { kind: "clear" } : { kind: "set", dimensionType };
}

/** Narrow an untrusted string, for the write path. */
export function isDimensionType(v: unknown): v is DimensionType {
  return typeof v === "string" && (DIMENSION_TYPES as readonly string[]).indexOf(v) !== -1;
}
