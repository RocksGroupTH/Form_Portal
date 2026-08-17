/**
 * The `GET /api/form-environment` payload shape — types only, no imports from
 * `next/headers`/`next/server`/the db pools, so this file is safe to import
 * from both the route handler and the client hook. Before this split the two
 * sides hand-declared the same shape twice; a future field added to one side
 * and not the other would show up as a silent `undefined` in a chip rather
 * than a `tsc` error.
 */

export type FormEnvironment = "Production" | "UAT";

/** One form's resolution for the current viewer. */
export interface FormAccess {
  /** Which database this form writes to for the current viewer. */
  environment: FormEnvironment;
  /** Whether the viewer may use the form at all right now. */
  available: boolean;
}

/**
 * The viewer's own UAT-tester standing — separate from any one form, and
 * what the navbar switch (see plan Task 7) renders from.
 */
export interface ViewerUatStatus {
  /** Has an active row in UatTester, whether or not UAT mode is on right now. */
  isTester: boolean;
  /** Cookie on AND an active tester — the effective mode every write choke point honours. */
  uatMode: boolean;
  /** Whether any form has its UAT switch on, for anybody — not just this viewer. */
  anyUatForm: boolean;
  /** The viewer's own tester row names a manager. */
  hasUatManager: boolean;
}

export interface FormEnvironmentPayload {
  viewer: ViewerUatStatus;
  forms: Record<string, FormAccess>;
}
