import type { FormEnvironmentValue } from "./service";

/** A form's two independent switches. */
export interface FormSwitches {
  /** Open to everyone, on the production database. */
  productionEnabled: boolean;
  /** Open to configured testers who have turned their own UAT mode on. */
  uatEnabled: boolean;
}

/** A form with no row in FormEnvironment: live, and not open for testing. */
export const PRODUCTION_ONLY: FormSwitches = { productionEnabled: true, uatEnabled: false };

export interface EnvironmentDecision {
  /** Which database answers. */
  environment: FormEnvironmentValue;
  /** Whether this viewer may use the form at all right now. */
  available: boolean;
}

export interface PickEnvironmentInput {
  /**
   * The environment named by the request id in the path, when the route is
   * acting on one record. UAT identities start at 900000, so an id says which
   * database holds it.
   */
  idEnvironment?: FormEnvironmentValue | null;
  /** Cookie set AND the viewer is an active tester — both already verified. */
  viewerUatMode: boolean;
  /** The form's switches, or null when it has no row. */
  form: FormSwitches | null;
}

/**
 * Which database this viewer works in, and whether the form is open to them.
 *
 * Production and UAT run side by side: ordinary users follow the production
 * switch, a tester in UAT mode follows the UAT switch, and neither can see the
 * other's half. Exactly one switch answers for a given viewer — a form open
 * only in UAT is invisible to everyone else, which is how a new form is piloted.
 *
 * An existing record outranks both. Its id names the database that holds it, so
 * a manager who is not a tester can still open, read and approve a tester's UAT
 * request — reading what already exists is not the same as filing something new,
 * which is why an id stays available even when both switches are off.
 *
 * Pure: every input is supplied by the caller.
 */
export function pickEnvironment(input: PickEnvironmentInput): EnvironmentDecision {
  if (input.idEnvironment) {
    return { environment: input.idEnvironment, available: true };
  }

  const form = input.form ?? PRODUCTION_ONLY;

  return input.viewerUatMode
    ? { environment: "UAT", available: form.uatEnabled }
    : { environment: "Production", available: form.productionEnabled };
}

/**
 * The id environment, or null when this viewer may not follow it.
 *
 * An id outranks both switches, but not unconditionally: without a bound, an id
 * >= 900000 would keep the UAT database open to anybody long after UAT was
 * switched off, and turning the switch off would close nothing. A UAT id is
 * honoured only while the form is still open for testing, or the viewer is a
 * tester in UAT mode — a tester keeps reaching their own records even after an
 * admin ends the pilot.
 *
 * A Production id is never bounded. It names the live database, which is where
 * an ordinary viewer belongs anyway, and it is what stops a tester in UAT mode
 * from being bounced out of a production record they opened deliberately.
 *
 * Shared by `resolveFormEnvironment` and `resolveCurrentFormAccess` so the
 * database a record loads from and the verdict on writing to it are computed
 * the same way — two copies of this rule is how a viewer ends up reading a
 * record they are then refused permission to save.
 *
 * Pure: every input is supplied by the caller.
 */
export function boundIdEnvironment(
  idEnvironment: FormEnvironmentValue | null | undefined,
  form: FormSwitches | null,
  viewerUatMode: boolean,
): FormEnvironmentValue | null {
  if (!idEnvironment) return null;
  if (idEnvironment !== "UAT") return idEnvironment;
  const switches = form ?? PRODUCTION_ONLY;
  return switches.uatEnabled || viewerUatMode ? "UAT" : null;
}
