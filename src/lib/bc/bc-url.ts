/**
 * **Business Central URL construction — pure, and import-free on purpose.**
 *
 * These three functions were in `bc-odata.ts`, which reaches
 * `db/connection-crypto` and `bc-connection` and so drags `@/env` in; `@/env`
 * validates the whole environment at import, so nothing could unit-test them.
 * They are string in, string out, and they decide which Business Central
 * *environment* every sync and every journal post talks to — which is exactly
 * the kind of rule this repository keeps pulling into an import-free module
 * (`api-keys/codes.ts`, `payment-calendar-core.ts`, `request-acl-policy.ts`).
 *
 * `bc-odata.ts` re-exports all three, so every existing import keeps working.
 *
 * ## The environment default is the trap, and it is kept deliberately
 *
 * `environment` defaults to `"Production"`, and both builders APPEND it unless
 * the base URL already ends in it. That was right while Production was the only
 * answer, and it stayed right for every Production caller — which is why
 * nothing failed for as long as there was nothing else to be.
 *
 * A Sandbox connection's base URL ends in `/Sandbox`. Omit the argument there
 * and the result is
 *
 *     .../{tenant}/Sandbox/Production/ODataV4/Company('…')/GeneralJournalBatches
 *
 * — two environment segments, which Business Central answers **400
 * RequestDataInvalid**. Measured 2026-09-23, on the first UAT sync after the
 * settings routes started resolving UAT at all.
 *
 * **The default is not removed**, because making the argument required would
 * be a compile error at a dozen Production call sites that are all correct, and
 * because a caller that genuinely has a Production base URL passing nothing is
 * still right. What guards it instead is `bc-url-environment-guard.test.ts`,
 * which reads the sync modules and asserts each call names the environment —
 * the omission is not a type error, not a lint warning, and produces a URL that
 * looks plausible right up until BC refuses it.
 */

const BC_HOST = "api.businesscentral.dynamics.com";

/** The environment segment used when a caller does not name one. */
export const DEFAULT_BC_ENVIRONMENT = "Production";

/** Escape a company name for the OData `Company('...')` segment. */
export function escapeODataCompanyName(name: string): string {
  return name.trim().replace(/'/g, "''");
}

/**
 * ODataV4 entity URL from `BcConnection.BaseUrl` + company name + entity set.
 *
 * The base URL is typically
 * `https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}`, and
 * the `endsWith` test is what stops the environment being added twice when it
 * is already there.
 */
export function buildBcODataEntityUrl(
  baseUrl: string,
  companyName: string,
  entitySet: string,
  environment: string = DEFAULT_BC_ENVIRONMENT,
): string {
  const root = baseUrl.trim().replace(/\/+$/, "");
  const company = escapeODataCompanyName(companyName);

  const envSegment = `/${environment}`;
  if (root.toLowerCase().endsWith(envSegment.toLowerCase())) {
    return `${root}/ODataV4/Company('${company}')/${entitySet}`;
  }

  if (!root.toLowerCase().includes(BC_HOST)) {
    throw new Error("BC Base URL must point to api.businesscentral.dynamics.com");
  }

  return `${root}${envSegment}/ODataV4/Company('${company}')/${entitySet}`;
}

/**
 * BC API v2.0 entity URL:
 * `.../{environment}/api/v2.0/companies({companyId})/{entitySet}`.
 *
 * `companyId` is `BrandConfig.bcId` — a GUID, not the display name the OData
 * builder above takes.
 */
export function buildBcApiV2CompanyEntityUrl(
  baseUrl: string,
  companyId: string,
  entitySet: string,
  environment: string = DEFAULT_BC_ENVIRONMENT,
): string {
  const root = baseUrl.trim().replace(/\/+$/, "");
  const company = companyId.trim();
  if (!company) throw new Error("BC Company Id is required");

  const envSegment = `/${environment}`;
  const apiRoot = root.toLowerCase().endsWith(envSegment.toLowerCase())
    ? root
    : `${root}${envSegment}`;

  if (!apiRoot.toLowerCase().includes(BC_HOST)) {
    throw new Error("BC Base URL must point to api.businesscentral.dynamics.com");
  }

  return `${apiRoot}/api/v2.0/companies(${company})/${entitySet}`;
}

/**
 * An ODataV4 unbound action URL: `{root}[/{env}]/ODataV4/{action}`.
 *
 * Same environment rule as the two builders above, and the same reason it sits
 * here: `postBcCodexStoreRpc` builds every Codex RPC call through it, so the
 * segment it chooses decides which Business Central a vendor or location sync
 * actually reads.
 *
 * It takes the environment as a REQUIRED argument rather than defaulting it —
 * it always had, and that is why no caller of it built a doubled segment.
 */
export function buildBcActionUrl(
  baseUrl: string,
  environment: "Production" | "Sandbox",
  action: string,
): string {
  const root = baseUrl.trim().replace(/\/+$/, "");
  const env = environment === "Sandbox" ? "Sandbox" : "Production";
  const envSegment = `/${env}`;

  if (root.toLowerCase().endsWith(envSegment.toLowerCase())) {
    return `${root}/ODataV4/${action}`;
  }

  if (!root.toLowerCase().includes(BC_HOST)) {
    throw new Error("BC Base URL must point to api.businesscentral.dynamics.com");
  }

  return `${root}${envSegment}/ODataV4/${action}`;
}
