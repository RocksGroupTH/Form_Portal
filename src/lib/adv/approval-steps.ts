/**
 * AP-2 approval step types. The amount matrix (AccAdvanceApprovalTier.Steps) is
 * an ordered CSV of these. Pure/client-safe — no I/O.
 */

export const STEP_TYPES = ["HEAD_DEPT", "HEAD_ACC", "DIRECTOR", "ACC_OFFICER"] as const;
export type StepType = (typeof STEP_TYPES)[number];

/**
 * Steps offered when building the amount matrix. HEAD_DEPT (department head) is
 * retired — AP-2 approval starts at Head Accounting — but the type stays valid
 * so any legacy row still parses.
 */
export const SELECTABLE_STEPS: StepType[] = ["HEAD_ACC", "DIRECTOR", "ACC_OFFICER"];

export function isStepType(v: unknown): v is StepType {
  return typeof v === "string" && (STEP_TYPES as readonly string[]).includes(v);
}

export const STEP_LABEL: Record<StepType, string> = {
  HEAD_DEPT: "หัวหน้าแผนก",
  HEAD_ACC: "Head Accounting",
  DIRECTOR: "ผู้บริหาร",
  ACC_OFFICER: "Accounting Officer",
};

/** HEAD_DEPT resolves to the requester's manager; the rest are configured approver lists. */
export function isManagerStep(t: StepType): boolean {
  return t === "HEAD_DEPT";
}

/** Only the Accounting Officer step picks a payment date and checks. */
export function needsPayment(t: StepType): boolean {
  return t === "ACC_OFFICER";
}

/** The AccAdvanceApprover role backing a configured step ("" for the manager step). */
export function stepApproverRole(t: StepType): "HEAD_ACC" | "DIRECTOR" | "ACC_OFFICER" | null {
  return t === "HEAD_DEPT" ? null : t;
}

/** Parse the tier's CSV into a validated, ordered step list. */
export function parseSteps(csv: string | null | undefined): StepType[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(isStepType);
}

export function stepsToCsv(steps: StepType[]): string {
  return steps.join(",");
}
