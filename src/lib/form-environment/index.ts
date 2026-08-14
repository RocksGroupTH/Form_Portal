import { cache } from "react";
import { headers } from "next/headers";
import { classifyPath, type PathClass } from "./classify-path";
import { getFormEnvironmentMap, type FormEnvironmentValue } from "./service";

export { classifyPath, ROUTE_RULES } from "./classify-path";
export type { PathClass, FormCode, RouteRule } from "./classify-path";
export type { FormEnvironmentValue, FormEnvironmentRow } from "./service";
export {
  getFormEnvironmentMap,
  setFormEnvironment,
  listFormEnvironments,
} from "./service";

/**
 * The current request's path, or null when there is no request.
 *
 * Scripts, apply-sql and background work have no request scope; `headers()`
 * throws there. Returning null makes those callers resolve to Production, which
 * is the safe direction: the failure mode is reading live data, never writing
 * test data into it.
 */
async function currentPath(): Promise<string | null> {
  try {
    return (await headers()).get("x-pathname");
  } catch {
    return null;
  }
}

/** What the current path maps to. Memoized for the life of one request. */
export const resolveFormClass = cache(async (): Promise<PathClass> => {
  return classifyPath(await currentPath());
});

/**
 * Which form database the current request should use.
 *
 * Production unless a form-specific route resolves to a form flagged UAT.
 * Aggregate ("BOTH") routes resolve to Production here — they reach the UAT
 * database deliberately, through queryBothPools.
 */
export const resolveFormEnvironment = cache(async (): Promise<FormEnvironmentValue> => {
  const cls = await resolveFormClass();
  if (cls === null || cls === "BOTH") return "Production";
  const map = await getFormEnvironmentMap();
  return map[cls] ?? "Production";
});
