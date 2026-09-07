import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";

/**
 * The override-wins decision — pure, and importing nothing at runtime (the one
 * import above is a type, erased by the compiler). Extracted out of
 * `allowance-log.ts` so this decision is unit-tested without a database.
 *
 * `allowance-log.ts` is reached from inside a `getAccPool()` transaction, so a
 * static import of `@/lib/db/mssql` — or anything that reaches it — on this
 * path would be exactly the cycle `getFormPool` dynamically imports the
 * environment resolver to avoid. This file must stay import-free for the same
 * reason `perdiem-country.ts` and `per-diem-rule.ts` are: an inverted condition
 * or a wrongly-keyed `overrides.get` here silently prices a tester at their
 * real HR allowance, or a production user at a tester's rate, and neither the
 * typecheck nor the existing lexical guard test would catch it — that guard
 * only proves the wrapper is *called*, never that it decides correctly.
 *
 * `getPerDiemEmployeeLogMap` (`allowance-log.ts`) is the only caller: it
 * fetches `overrides` (`Rocks_Portal_Form_UAT.dbo.UatTesterPerDiem`, keyed on
 * StaffId) and `hrLogs` (`Rocks_Portal_HR.dbo.EmployeeAllowanceLog`, keyed on
 * EmployeeId) and hands them here, once per subject, to decide which log
 * answers.
 */

/**
 * Who a per-diem log is being loaded for, and whether this is a UAT record.
 *
 * `uat` is a PARAMETER, never resolved inside this module or `allowance-log.ts`
 * — see that file's own comment for why a static import of the environment
 * resolver cannot live on this path.
 */
export interface PerDiemLogSubject {
  employeeId: string | null;
  staffId: number | null;
  uat: boolean;
}

export function perDiemLogSubjectKey(s: PerDiemLogSubject): string {
  return `${s.uat ? "u" : "p"}:${s.staffId ?? ""}:${s.employeeId ?? ""}`;
}

/** Which log answered a subject — `"uat"` for a tester's own configured rate, `"hr"` otherwise. */
export type PerDiemLogSource = "hr" | "uat";

/** A subject's resolved log, plus which log it came from. */
export interface PerDiemEmployeeLogResult {
  log: AllowanceLogEntry[];
  source: PerDiemLogSource;
}

/**
 * **The single decision point.** A subject answered by the UAT override gets
 * `source: "uat"`; every other subject — including one with no employee id at
 * all, whose log is `[]` — gets `source: "hr"`. Never throws: a subject with
 * neither an override nor an employee id still answers `{ log: [], source:
 * "hr" }`, the fail-safe "no rate configured" reading.
 *
 * `overrides` only ever holds an entry for a tester WITH a configured rate —
 * "no entry" and "not a tester" look the same here, which is also the
 * fail-safe direction. A subject with `uat: true` but a null `staffId` cannot
 * be looked up in `overrides` at all (the map is keyed on `number`), so it
 * falls straight through to the HR arm, exactly like a non-UAT subject.
 */
export function chooseSubjectLog(
  s: PerDiemLogSubject,
  overrides: ReadonlyMap<number, AllowanceLogEntry[]>,
  hrLogs: ReadonlyMap<string, AllowanceLogEntry[]>,
): PerDiemEmployeeLogResult {
  const override = s.uat && typeof s.staffId === "number" ? overrides.get(s.staffId) : undefined;
  if (override !== undefined) {
    return { log: override, source: "uat" };
  }
  return { log: s.employeeId ? (hrLogs.get(s.employeeId) ?? []) : [], source: "hr" };
}
