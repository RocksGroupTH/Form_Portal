/** Business Central OAuth2 token requests (server-only). */

export interface BcTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface BcTokenRequest {
  oauthUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string | null;
  username?: string | null;
  password?: string | null;
}

function parseTokenResponse(json: Record<string, unknown>): BcTokenResult {
  const accessToken = json.access_token as string | undefined;
  if (!accessToken) {
    const err = (json.error_description as string) || (json.error as string) || "No access_token in response";
    throw new Error(err);
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : Number(json.expires_in) || 3600;
  const refreshToken = json.refresh_token as string | undefined;
  return { accessToken, refreshToken, expiresIn };
}

/** Request OAuth2 token (client_credentials or password grant). */
export async function requestBcOAuthToken(input: BcTokenRequest): Promise<BcTokenResult> {
  const body = new URLSearchParams();
  body.set("client_id", input.clientId);
  body.set("client_secret", input.clientSecret);

  const hasUser = !!(input.username?.trim() && input.password);
  if (hasUser) {
    body.set("grant_type", "password");
    body.set("username", input.username!.trim());
    body.set("password", input.password!);
  } else {
    body.set("grant_type", "client_credentials");
  }

  if (input.scope?.trim()) {
    body.set("scope", input.scope.trim());
  }

  const res = await fetch(input.oauthUrl.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (json.error_description as string) ||
      (json.error as string) ||
      `Token request failed (${res.status})`;
    throw new Error(err);
  }

  return parseTokenResponse(json);
}

/** Refresh token grant when refresh token is available. */
export async function refreshBcOAuthToken(input: {
  oauthUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  scope?: string | null;
}): Promise<BcTokenResult> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("client_id", input.clientId);
  body.set("client_secret", input.clientSecret);
  body.set("refresh_token", input.refreshToken);
  if (input.scope?.trim()) body.set("scope", input.scope.trim());

  const res = await fetch(input.oauthUrl.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      (json.error_description as string) ||
      (json.error as string) ||
      `Refresh token failed (${res.status})`;
    throw new Error(err);
  }

  return parseTokenResponse(json);
}

const BC_HOST = "api.businesscentral.dynamics.com";
const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build a valid BC API test URL from BaseUrl.
 * BC requires: .../v2.0/{tenantId}/{environment}/api/v2.0/companies
 */
export function resolveBcTestUrl(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (!url) throw new Error("Base URL is required");

  if (/\/companies(\?|$|\/)/i.test(url) || /\/\$metadata(\?|$)/i.test(url)) {
    return url;
  }
  if (/\/api\/v2\.0$/i.test(url)) {
    return `${url}/companies`;
  }

  // .../v2.0/{tenant}/{environment}
  const parts = url.split("/");
  const v2Idx = parts.findIndex((p) => p.toLowerCase() === "v2.0");
  if (v2Idx >= 0 && parts[v2Idx + 1] && TENANT_GUID.test(parts[v2Idx + 1])) {
    const tenantId = parts[v2Idx + 1];
    const environment = parts[v2Idx + 2];
    if (!environment) {
      throw new Error(
        `Base URL is incomplete — add environment after tenant ID, e.g. https://${BC_HOST}/v2.0/${tenantId}/Production/api/v2.0/companies`,
      );
    }
    const afterEnv = parts.slice(v2Idx + 3).join("/");
    if (!afterEnv || !afterEnv.toLowerCase().startsWith("api/")) {
      return `${url}/api/v2.0/companies`;
    }
  }

  if (url.toLowerCase().includes(BC_HOST)) {
    return `${url}/api/v2.0/companies`;
  }

  return url;
}

function formatBcApiError(status: number, text: string): string {
  if (status === 400 && /RequestDataInvalid/i.test(text)) {
    return (
      "BC API returned 400 (Request data is invalid) — Base URL is likely incomplete. " +
      "Use full path: https://api.businesscentral.dynamics.com/v2.0/{tenant-id}/Production/api/v2.0/companies"
    );
  }
  return `BC API returned ${status}${text ? `: ${text.slice(0, 280)}` : ""}`;
}

/** Probe BC API with Bearer token (GET companies on resolved BaseUrl). */
export async function testBcApiAccess(baseUrl: string, accessToken: string): Promise<void> {
  const url = resolveBcTestUrl(baseUrl);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(formatBcApiError(res.status, text));
  }
}
