import { classifyPath } from "./classify-path";
import { isUatId } from "./uat-identity";
import type { FormEnvironmentValue } from "./service";

/**
 * The request id a form-scoped route is acting on, or null.
 *
 * Per-form routing normally picks the database from the form's switches, but a
 * route that names an existing record must go where that record lives — a
 * manager who is not a tester still has to open a tester's UAT request. UAT
 * identities start at 900000 (migration 061), so the id names its own database.
 *
 * Only paths `classifyPath` assigns to a single form are considered. Settings
 * are deliberately unclassified, aggregates span both databases, and
 * new-item-inventory reads Fast_Core — a number in any of those is not an
 * AccRequest id. Within a form's paths every dynamic segment is an id of a table
 * migration 061 reseeded (request, file, item), so the first one found answers
 * for the whole path: in `/requests/900001/items/900456` the request owns the
 * item.
 *
 * Pure and client-safe: no request context, no I/O.
 */
export function requestIdFromPath(path: string | null | undefined): number | null {
  if (!path) return null;

  const formCode = classifyPath(path);
  if (formCode === null || formCode === "BOTH") return null;

  // Same normalisation classifyPath applies, so a query string carrying a
  // number (`…/files?fileId=900456`) cannot be read as the id.
  const clean = path.split("?")[0].replace(/\/+$/, "");

  for (const segment of clean.split("/")) {
    if (segment !== "" && /^\d+$/.test(segment)) {
      const id = Number(segment);
      if (Number.isSafeInteger(id)) return id;
    }
  }
  return null;
}

/**
 * Which database the record in this path lives in, or null when the path names
 * no record and the caller has to decide some other way.
 */
export function environmentFromPath(
  path: string | null | undefined,
): FormEnvironmentValue | null {
  const id = requestIdFromPath(path);
  if (id === null) return null;
  return isUatId(id) ? "UAT" : "Production";
}
