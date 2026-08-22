/**
 * Where a Business Central credential may be sent.
 *
 * ## Why an allowlist
 *
 * Both BC destinations are configured by IT/System Admin and both carry secrets
 * to whatever address they name. `requestBcOAuthToken` posts `client_id` +
 * `client_secret` (and, on the password grant, a username and password) to
 * `oauthUrl`; `testBcApiAccess` and `postBcPpapJournalCreateFromJson` send a
 * bearer token to a URL derived from `baseUrl`. `resolveBcTestUrl` ends with a
 * bare `return url`, so anything that did not look like a BC address was passed
 * through untouched and fetched as given.
 *
 * Nothing about that requires a compromised account: it is a settings form whose
 * value is a URL, and the URL receives credentials. An allowlist turns the field
 * back into a choice among real destinations.
 *
 * ## The rules
 *
 * HTTPS only, no credentials in the URL, host must match the allowlist by exact
 * name or as a subdomain, and no IP-literal or link-local host. `http://` is
 * refused outright rather than upgraded, because a value someone typed as
 * `http://` is a value they should be told about.
 *
 * The defaults are Microsoft's own endpoints. `BC_ALLOWED_OAUTH_HOSTS` and
 * `BC_ALLOWED_API_HOSTS` (comma-separated) extend them for a tenant that fronts
 * BC behind its own gateway — deliberately additive, and deliberately env-only
 * so it is not editable from the same settings page as the URL itself.
 *
 * These are pure string checks. They stop a destination being *named*; they do
 * not follow redirects or re-resolve DNS, so they are not on their own a defence
 * against a host that is allowlisted and then repointed. `fetch` follows
 * redirects by default, which is why the callers pass `redirect: "error"`.
 */

const DEFAULT_OAUTH_HOSTS = [
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.windows.net",
];

const DEFAULT_API_HOSTS = [
  "api.businesscentral.dynamics.com",
  "businesscentral.dynamics.com",
];

function fromEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** An IPv4/IPv6 literal, or a name that resolves to the host itself or its link-local range. */
function isForbiddenHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]" || host.startsWith("[")) return true; // any IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // any IPv4 literal
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => host === a || host.endsWith(`.${a}`));
}

export class BcDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BcDestinationError";
  }
}

function assertDestination(
  rawUrl: string,
  allowed: readonly string[],
  label: string,
): URL {
  const value = (rawUrl ?? "").trim();
  if (!value) throw new BcDestinationError(`${label} is required`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BcDestinationError(`${label} is not a valid absolute URL`);
  }

  if (url.protocol !== "https:") {
    throw new BcDestinationError(`${label} must use https:// (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new BcDestinationError(`${label} must not embed a username or password`);
  }

  const host = url.hostname.toLowerCase();
  if (isForbiddenHost(host)) {
    throw new BcDestinationError(`${label} may not point at ${url.hostname}`);
  }
  if (!hostAllowed(host, allowed)) {
    throw new BcDestinationError(
      `${label} host ${url.hostname} is not an approved Business Central destination. ` +
        `Approved: ${allowed.join(", ")}.`,
    );
  }
  return url;
}

/** Approved OAuth token endpoints. Defaults plus `BC_ALLOWED_OAUTH_HOSTS`. */
export function allowedOAuthHosts(): string[] {
  return [...DEFAULT_OAUTH_HOSTS, ...fromEnv("BC_ALLOWED_OAUTH_HOSTS")];
}

/** Approved BC API hosts. Defaults plus `BC_ALLOWED_API_HOSTS`. */
export function allowedApiHosts(): string[] {
  return [...DEFAULT_API_HOSTS, ...fromEnv("BC_ALLOWED_API_HOSTS")];
}

/** Throws `BcDestinationError` unless a client secret may be posted to this URL. */
export function assertOAuthDestination(rawUrl: string): URL {
  return assertDestination(rawUrl, allowedOAuthHosts(), "OAuth token URL");
}

/** Throws `BcDestinationError` unless a bearer token may be sent to this URL. */
export function assertApiDestination(rawUrl: string): URL {
  return assertDestination(rawUrl, allowedApiHosts(), "BC API URL");
}

/**
 * Which stored-secret fields a proposed edit invalidates.
 *
 * `PATCH /api/settings/bc-connections/[id]` accepts a body whose `clientSecret`
 * and `password` are optional — the form omits them when they have not been
 * retyped — while `oauthUrl`, `clientId` and `username` are all editable. So an
 * edit could repoint the destination, or rename the client, and leave the stored
 * secret in place to be sent under the new identity to the new address. Same
 * shape as the SQL connection test, and the same rule: a stored secret belongs
 * to the destination and identity it was stored against.
 *
 * Returns the names of the changed fields that require a secret to be re-entered,
 * or an empty array when the edit is safe.
 */
export function bcSecretRebindRequired(input: {
  stored: { oauthUrl: string; clientId: string; username: string | null };
  next: { oauthUrl?: string | null; clientId?: string | null; username?: string | null };
  /** True when the caller supplied a fresh client secret in this request. */
  clientSecretSupplied: boolean;
  /** True when the caller supplied a fresh resource-owner password. */
  passwordSupplied: boolean;
}): string[] {
  const changed: string[] = [];
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

  const oauthChanged =
    input.next.oauthUrl != null && norm(input.next.oauthUrl) !== norm(input.stored.oauthUrl);
  const clientChanged =
    input.next.clientId != null && norm(input.next.clientId) !== norm(input.stored.clientId);
  const usernameChanged =
    input.next.username != null && norm(input.next.username) !== norm(input.stored.username);

  // The client secret is bound to the token endpoint and the client it
  // identifies; either moving means it has to be supplied again.
  if ((oauthChanged || clientChanged) && !input.clientSecretSupplied) {
    if (oauthChanged) changed.push("oauthUrl");
    if (clientChanged) changed.push("clientId");
  }
  // The resource-owner password is bound to the username, and only exists on
  // connections that use the password grant.
  if (usernameChanged && input.stored.username && !input.passwordSupplied) {
    changed.push("username");
  }
  return changed;
}
