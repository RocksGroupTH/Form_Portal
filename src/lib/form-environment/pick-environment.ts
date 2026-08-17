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
