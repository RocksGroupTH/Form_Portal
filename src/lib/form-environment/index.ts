import { cache } from "react";
import { cookies, headers } from "next/headers";
import { classifyPath, type PathClass } from "./classify-path";
import { getFormSwitchMap, type FormEnvironmentValue } from "./service";
import {
  boundIdEnvironment,
  pickEnvironment,
  PRODUCTION_ONLY,
  type EnvironmentDecision,
} from "./pick-environment";
import { environmentFromPath } from "./request-id";
import { UAT_MODE_COOKIE, isUatModeCookieOn } from "@/lib/uat-mode";

export { classifyPath, matchRule, ROUTE_RULES } from "./classify-path";
export type { PathClass, FormCode, RouteRule } from "./classify-path";
export type { FormEnvironmentValue, FormEnvironmentRow } from "./service";
export type { FormSwitches, EnvironmentDecision } from "./pick-environment";
export { pickEnvironment, boundIdEnvironment, PRODUCTION_ONLY } from "./pick-environment";
export { requestIdFromPath, environmentFromPath } from "./request-id";
export {
  getFormSwitchMap,
  setFormFlag,
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

/**
 * The raw UAT-mode cookie, or null when there is no request.
 *
 * Same try/catch as `currentPath()`, for the same reason: `cookies()` throws
 * outside a request scope, and the background email drain must resolve
 * Production rather than blow up.
 */
const currentUatMode = cache(async (): Promise<string | null> => {
  try {
    return (await cookies()).get(UAT_MODE_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
});

/**
 * Who is asking, from the `x-user-email` header the proxy publishes, or null
 * when there is no request. Never `@/lib/auth` — `getFormPool()` dynamically
 * imports this module and `auth()` reads Fast_Core, so going through the
 * session would close the loop `getFormPool → auth → jwt → getFormPool`.
 */
const currentViewerEmail = cache(async (): Promise<string | null> => {
  try {
    return (await headers()).get("x-user-email");
  } catch {
    return null;
  }
});

/** What the current path maps to. Memoized for the life of one request. */
export const resolveFormClass = cache(async (): Promise<PathClass> => {
  return classifyPath(await currentPath());
});

/**
 * The viewer's UAT mode: only true when the cookie is set AND they are an
 * active tester. The cookie alone is a hint anyone can forge, so membership is
 * re-checked here on every resolve.
 *
 * The tester service is imported dynamically to keep the static module graph of
 * the resolver free of anything that could reach `getFormPool()`.
 */
const viewerIsTesting = cache(async (): Promise<boolean> => {
  if (!isUatModeCookieOn(await currentUatMode())) return false;
  const { getActiveUatTester } = await import("@/lib/uat-tester/service");
  return (await getActiveUatTester(await currentViewerEmail())) !== null;
});

/**
 * The current request's form: which database answers, and whether this viewer
 * may write to it.
 *
 * Production and UAT run side by side, so this answers for one viewer on one
 * route: the record named in the path wins (bounded — see `boundIdEnvironment`),
 * then the viewer's UAT mode, then the form's switches. Aggregate ("BOTH")
 * routes and unclassified paths resolve to Production — they reach the UAT
 * database deliberately, through queryBothPools.
 *
 * This is the one to use at a write choke point, and it must be judged on the
 * resolved environment rather than the cookie: a tester with UAT mode off
 * editing a UAT draft is routed there by the id rule, and has to be allowed to
 * save what they were just allowed to open.
 *
 * Safe with no request scope: `resolveFormClass()` returns null there, so this
 * answers Production without touching the cookie, the header or the database.
 */
export const resolveCurrentFormAccess = cache(async (): Promise<EnvironmentDecision> => {
  const cls = await resolveFormClass();
  // An aggregate or unclassified route is not a form anyone files, so there is
  // nothing to be shut out of: Production, and available.
  if (cls === null || cls === "BOTH") return { environment: "Production", available: true };

  const [switches, testing] = await Promise.all([getFormSwitchMap(), viewerIsTesting()]);
  const form = switches[cls] ?? PRODUCTION_ONLY;
  const idEnvironment = boundIdEnvironment(
    environmentFromPath(await currentPath()),
    form,
    testing,
  );

  return pickEnvironment({ idEnvironment, viewerUatMode: testing, form });
});

/**
 * Which form database the current request should use.
 *
 * Derived from `resolveCurrentFormAccess()` rather than recomputing, so the pool
 * a record loads from can never disagree with the verdict on writing to it.
 *
 * Signature stays argument-free and the default stays Production: `getFormPool()`
 * depends on both, and every script and background job reaches it with no
 * request scope.
 */
export const resolveFormEnvironment = cache(async (): Promise<FormEnvironmentValue> => {
  return (await resolveCurrentFormAccess()).environment;
});

/**
 * Where a named form answers for this viewer, and whether it is open to them.
 *
 * For asking about a form from somewhere else — Home asks about AP-1 and AP-17
 * while sitting on `/`. It deliberately ignores the request id, because the id
 * in the current path (if any) belongs to a different form than the one being
 * asked about. At a write choke point on the form's own route, use
 * `resolveCurrentFormAccess()` instead: that one honours the record's id, which
 * is what lets a tester with UAT mode off still save the UAT draft they just
 * opened.
 */
export async function resolveFormAccess(formCode: string) {
  const [switches, testing] = await Promise.all([getFormSwitchMap(), viewerIsTesting()]);
  return pickEnvironment({ viewerUatMode: testing, form: switches[formCode] ?? null });
}

/**
 * What each form resolves to for this viewer — for the merged-list filters.
 *
 * A merged read shows a person rows from both databases; this map says which
 * database each form is theirs to see today, so `keepRowsInCurrentEnvironment`
 * can drop the other half.
 */
export async function resolveViewerEnvironmentMap(): Promise<Record<string, FormEnvironmentValue>> {
  const [switches, testing] = await Promise.all([getFormSwitchMap(), viewerIsTesting()]);
  const out: Record<string, FormEnvironmentValue> = {};
  for (const code of Object.keys(switches)) {
    out[code] = pickEnvironment({ viewerUatMode: testing, form: switches[code] }).environment;
  }
  return out;
}
