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
 * Which database a **merged list** shows this viewer for one form.
 *
 * `pickEnvironment` answers with two fields and a list filter needs one, so the
 * fold has to be deliberate. Reading `environment` alone is wrong: that field
 * says "UAT" for any viewer in UAT mode, whether or not the form's UAT switch is
 * on — only `available` consults it. Folding on `environment` alone therefore
 * filtered a tester in UAT mode onto UAT for *every* form, so a real AP-1 claim
 * sitting at ACCOUNT vanished from the account approver's `/my-work` — and the
 * design requires at least one `AccApprover` to be an active tester, so somebody
 * always has that tester row. The `boundIdEnvironment` escape hatch could not
 * save them either: the list that would have handed them the URL is the thing
 * doing the filtering.
 *
 * So a form that is not open to this viewer where they stand falls back to
 * Production. A list is not a write choke point — it never files anything — and
 * availability is still enforced where it belongs, by `environmentWritable` at
 * the submit.
 *
 * The fallback swaps rather than purely adds: in the one state it changes — a
 * tester in UAT mode, on a form whose UAT switch is off — it lists that form's
 * production rows and stops listing its UAT ones. So ending a pilot while a
 * tester still has UAT mode on unlists their in-flight test requests. They are
 * not lost: `boundIdEnvironment` still honours a UAT id for a viewer in UAT
 * mode, so the records open by URL, and they list again the moment the switch
 * goes back on.
 *
 * Pure: every input is supplied by the caller.
 */
export function viewerListEnvironment(
  form: FormSwitches | null,
  viewerUatMode: boolean,
): FormEnvironmentValue {
  const decision = pickEnvironment({ viewerUatMode, form });
  return decision.available ? decision.environment : "Production";
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

/**
 * Whether a **write** may land in the environment that answered this request.
 *
 * Separate from `pickEnvironment().available` on purpose, because the two answer
 * different questions. `available` is about the viewer: may this person reach
 * the form at all — and an existing record always says yes, so that opening,
 * reading and approving keep working after a switch is turned off. This one is
 * about the books: is the database that answered still accepting new work for
 * this form. An id decides *which* environment, never *whether* it is open.
 *
 * Without the split, turning a form's `ProductionEnabled` off would close only
 * brand-new drafts: every draft already in flight carries its id in the path, so
 * it would keep submitting into production, allocating running numbers and
 * mailing real managers.
 *
 * Pure: every input is supplied by the caller.
 */
export function environmentWritable(
  environment: FormEnvironmentValue,
  form: FormSwitches | null,
): boolean {
  const switches = form ?? PRODUCTION_ONLY;
  return environment === "UAT" ? switches.uatEnabled : switches.productionEnabled;
}

/**
 * Whether a catalogue should show this form as **not yet open** rather than not
 * show it at all.
 *
 * A form whose UAT switch is on while Production is off is being piloted: it is
 * real, someone is working on it, and it will open. Hiding it outright tells an
 * ordinary user nothing — worse, searching its code returns "no results", which
 * reads as "no such form" instead of "not yet". So the catalogue renders it,
 * greyed and unclickable, and the card says what is true.
 *
 * Both exclusions are deliberate:
 *
 * - **Both switches off is not "soon".** That form is closed and nobody is
 *   piloting it. "Soon" is a promise, and this predicate must not make one on
 *   behalf of work that does not exist — it stays hidden.
 * - **A tester in UAT mode never sees "soon".** The form they are piloting is
 *   simply open to them; they are the pilot. And a prod-on/uat-off form is not
 *   "soon" for them either — it is just not part of the test, and stays hidden
 *   exactly as it was.
 *
 * Fail-open, like the rest of this module: a form with no row is PRODUCTION_ONLY
 * and therefore available, never deferred. A caller with no payload at all
 * should default to `false` for the same reason — a failed fetch must not put a
 * watermark on a form that works.
 *
 * Says nothing about writing. `environmentWritable` remains the sole authority
 * there, so a visible coming-soon card can never become a writable one.
 *
 * Pure: every input is supplied by the caller.
 */
export function isComingSoon(form: FormSwitches | null, viewerUatMode: boolean): boolean {
  if (viewerUatMode) return false;
  const switches = form ?? PRODUCTION_ONLY;
  return !switches.productionEnabled && switches.uatEnabled;
}
