/**
 * Where the browser should land after the viewer flips the navbar PRO/UAT
 * switch.
 *
 * The switch reloads the page so that nothing is left on screen from the
 * database the viewer just left. On a fill page that reload is not enough: the
 * record being edited is named by an `?id=` in the URL, so reloading as-is
 * re-opens the very record the switch was meant to walk away from — a UAT draft
 * comes straight back under a `PRO` chip, and the only hint is a manager card
 * complaining about UAT.
 *
 * UAT identities start at 900000 (migration 061), so the id alone says which
 * database its record lives in. When that disagrees with the mode being
 * switched *to*, drop the `id` and keep the rest of the URL: same page, blank
 * form, every other parameter (`from`, `new`, …) intact. The record is saved
 * server-side and still reachable from Home and My Requests, and a reload
 * discarded unsaved edits either way.
 *
 * Detail pages are untouched by design: there the id is a path segment, so
 * dropping it would navigate somewhere else entirely, and reading a record from
 * the other environment is deliberately allowed (`UatDataBanner` labels it).
 * AP-17's fill page resumes by `groupKey`, an opaque string that names no
 * environment, so nothing here can be said about it.
 *
 * Pure and client-safe: no request context, no I/O.
 */

import { isUatId } from "./uat-identity";

/**
 * True when reloading `currentUrl` after switching to `targetUatMode` would put
 * the viewer back inside a record belonging to the other database.
 *
 * `currentUrl` is an absolute URL (`window.location.href`). Anything
 * unparseable, or an `id` that is not a positive integer, answers false: this
 * only ever decides whether to drop a parameter, so an unreadable URL should
 * leave the existing behaviour alone rather than guess.
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
 * The URL to load after the switch: `currentUrl` unchanged in every ordinary
 * case, or the same URL with its `id` removed when that record belongs to the
 * database being switched away from.
 *
 * Returns the input string itself when nothing changes, so a caller can compare
 * by identity to decide between `location.assign` and `location.reload`.
 */
export function urlAfterUatSwitch(currentUrl: string, targetUatMode: boolean): string {
  if (!uatSwitchLeavesRecord(currentUrl, targetUatMode)) return currentUrl;

  const url = new URL(currentUrl);
  url.searchParams.delete("id");
  return url.toString();
}
