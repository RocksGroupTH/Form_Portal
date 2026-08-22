/**
 * Where the browser should land after the viewer flips the navbar PRO/UAT
 * switch: **Home, always.**
 *
 * The switch has to leave the current page behind, not just re-render it.
 * Nearly every list in this app is client-fetched through SWR, so a soft
 * refresh leaves rows on screen from the database the viewer just left; and on
 * a fill page the record being edited is named by an `?id=` in the URL, so even
 * a hard reload re-opens the very record the switch was meant to walk away from
 * — a UAT draft comes straight back under a `PRO` chip, and the only hint is a
 * manager card complaining about UAT.
 *
 * This used to strip the `id` and reload the same page, which fixed the fill
 * pages and nothing else: a queue, a report or a detail page still came back
 * showing the other environment's work until the viewer navigated away by hand.
 * Home is the one page that is correct in every environment, so the switch goes
 * there unconditionally rather than reasoning per-page about what survives.
 *
 * Pure and client-safe: no request context, no I/O.
 */

import { isUatId } from "./uat-identity";

/** Home — the form catalogue, correct to show in either environment. */
export const UAT_SWITCH_LANDING = "/";

/**
 * True when landing on Home would also leave the record named by `?id=` behind
 * — which is what the confirmation dialog says out loud before the viewer
 * commits to it.
 *
 * UAT identities start at 900000 (migration 061), so the id alone says which
 * database its record lives in; when that disagrees with the mode being
 * switched *to*, the record is one the viewer is walking away from. It is saved
 * server-side and still reachable from Home and My Requests — only unsaved
 * edits go, and a reload discarded those either way.
 *
 * Detail pages answer false by design: there the id is a path segment, and
 * reading a record from the other environment is deliberately allowed
 * (`UatDataBanner` labels it). AP-17's fill page resumes by `groupKey`, an
 * opaque string that names no environment, so nothing here can be said about
 * it.
 *
 * `currentUrl` is an absolute URL (`window.location.href`). Anything
 * unparseable, or an `id` that is not a positive integer, answers false: this
 * only decides whether to show one extra paragraph, so an unreadable URL should
 * stay quiet rather than guess.
 */
export function uatSwitchLeavesRecord(currentUrl: string, targetUatMode: boolean): boolean {
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return false;
  }

  const raw = url.searchParams.get("id");
  if (raw === null || !/^\d+$/.test(raw)) return false;

  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return false;

  return isUatId(id) !== targetUatMode;
}

/**
 * The absolute URL to load after the switch: Home, on `currentUrl`'s own
 * origin.
 *
 * Resolved against the current URL rather than returned as a bare `"/"` so the
 * caller can compare it with `window.location.href` and pick `location.reload()`
 * over `location.assign()` when the viewer is already on Home — assigning the
 * URL you are already at is not reliably a fresh load, and a fresh load is the
 * entire point.
 *
 * Taking the origin from the input is also what keeps this from becoming an
 * open redirect: the path is the constant above, never anything read out of the
 * URL, so no crafted link can aim it off-site.
 */
export function urlAfterUatSwitch(currentUrl: string): string {
  return new URL(UAT_SWITCH_LANDING, currentUrl).toString();
}
