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
  /**
   * Open for testing but not yet open in production, for a viewer who is not a
   * tester in UAT mode: the catalogue renders it greyed and unclickable rather
   * than hiding it. Never true at the same time as `available` — see
   * `isComingSoon` in `./pick-environment` for why each exclusion is there.
   */
  comingSoon: boolean;
  /**
   * Who to contact about this form, for the line at the foot of it.
   *
   * It rides on this payload rather than on a route of its own because
   * every form page already fetches this one — a second endpoint would be
   * a second gate and a second request to answer a contact line. It is
   * **never empty-vs-absent**: a form with no owner carries `[]`, so a
   * client can tell "nobody is named" from a payload that failed to load.
   */
  owners: FormOwnerRef[];
  /**
   * The form's notice copy, already split into blocks and with
   * `{เจ้าของฟอร์ม}` expanded against this form's own `owners`.
   *
   * Expanded server-side, so the five renderers receive a plain `string[]` and
   * share no logic beyond it — a client-side expansion would put the token
   * rule in the bundle five times.
   *
   * `[]` means "no notice", which is a fact; a client can tell it from a
   * payload that never arrived, exactly as `owners` can.
   */
  message: string[];
}

/** One named owner. Mirrors `FormOwner` in `./form-owner`, minus the id. */
export interface FormOwnerRef {
  email: string;
  displayName: string | null;
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
