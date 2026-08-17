import type { ViewerUatStatus } from "./payload-types";

/**
 * Whether this viewer has an environment to choose between.
 *
 * True for an active tester while some form is open to UAT testing, and always
 * true for someone already in UAT mode — an admin turning off the last
 * UAT-enabled form must not strand a tester in UAT with no control left to
 * switch back with.
 *
 * Everything the viewer can see says "Production" when this is false, because
 * `pickEnvironment` only ever answers UAT for a viewer in UAT mode. So this is
 * also the test for whether saying so is worth anything: the navbar switch and
 * the per-form chips both hide on it, and a viewer who cannot be anywhere but
 * Production is not told, over and over, that they are in Production.
 *
 * One function rather than the same boolean written in two components: they
 * have to agree, or a chip appears with no control beside it to explain what it
 * is contrasting with.
 *
 * Pure: every input is supplied by the caller.
 */
export function canSwitchEnvironment(viewer: ViewerUatStatus | null | undefined): boolean {
  if (!viewer) return false;
  return viewer.uatMode || (viewer.isTester && viewer.anyUatForm);
}
