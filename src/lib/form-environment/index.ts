import { cache } from "react";
import { cookies, headers } from "next/headers";
import { classifyPath, type PathClass } from "./classify-path";
import { getFormSwitchMap, type FormEnvironmentValue } from "./service";
import { pickEnvironment, PRODUCTION_ONLY } from "./pick-environment";
import { environmentFromPath } from "./request-id";
import { UAT_MODE_COOKIE, isUatModeCookieOn } from "@/lib/uat-mode";

export { classifyPath, matchRule, ROUTE_RULES } from "./classify-path";
export type { PathClass, FormCode, RouteRule } from "./classify-path";
export type { FormEnvironmentValue, FormEnvironmentRow } from "./service";
export type { FormSwitches, EnvironmentDecision } from "./pick-environment";
export { pickEnvironment, PRODUCTION_ONLY } from "./pick-environment";
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
 * Which form database the current request should use.
 *
 * Production and UAT run side by side, so this answers for one viewer on one
 * route: the record named in the path wins, then the viewer's UAT mode, then
 * the form's switches. Aggregate ("BOTH") routes and unclassified paths resolve
 * to Production here — they reach the UAT database deliberately, through
 * queryBothPools.
 *
 * Signature stays argument-free and the default stays Production: `getFormPool()`
 * depends on both, and every script and background job reaches it with no
 * request scope.
 */
export const resolveFormEnvironment = cache(async (): Promise<FormEnvironmentValue> => {
  const cls = await resolveFormClass();
  if (cls === null || cls === "BOTH") return "Production";
  const [switches, testing] = await Promise.all([getFormSwitchMap(), viewerIsTesting()]);
  const form = switches[cls] ?? PRODUCTION_ONLY;

  // The id rule is bounded: without this, an id >= 900000 would open the UAT
  // database to anybody even after UAT is switched off.
  const byId = environmentFromPath(await currentPath());
  const idEnvironment = byId === "UAT" && !(form.uatEnabled || testing) ? null : byId;

  return pickEnvironment({ idEnvironment, viewerUatMode: testing, form }).environment;
});

/**
 * Where a named form answers for this viewer, and whether it is open to them at
 * all. Use this at the write choke points — a form switched off for a viewer's
 * half must refuse the draft, not silently file it in the other database.
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
