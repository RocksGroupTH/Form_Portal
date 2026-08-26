/**
 * Business Central OData URL helpers and authenticated fetch (with token refresh).
 */

import { decryptPassword } from "@/lib/db/connection-crypto";
import { assertApiDestination } from "@/lib/bc/bc-destination";
import {
  getBcConnectionById,
  getBcAccessToken,
  refreshBcConnectionToken,
} from "@/lib/bc/bc-connection";

const BC_HOST = "api.businesscentral.dynamics.com";
const DEFAULT_ENVIRONMENT = "Production";
const BC_GET_TIMEOUT_MS = 30_000;
const BC_GET_MAX_TRANSIENT_RETRIES = 3;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(res: Response | null, retryNumber: number): number {
  const retryAfter = res?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), 30_000);
  }
  return Math.min(250 * (2 ** retryNumber), 5_000);
}

async function fetchBcGet(url: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BC_GET_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Escape company name for OData Company('...') segment. */
export function escapeODataCompanyName(name: string): string {
  return name.trim().replace(/'/g, "''");
}

/**
 * Build ODataV4 entity URL from BcConnection.BaseUrl + company + entity.
 * BaseUrl is typically: https://api.businesscentral.dynamics.com/v2.0/{tenantId}
 */
export function buildBcODataEntityUrl(
  baseUrl: string,
  companyName: string,
  entitySet: string,
  environment = DEFAULT_ENVIRONMENT,
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
 * Build BC API v2.0 entity URL: .../Production/api/v2.0/companies({companyId})/{entitySet}
 * companyId is BrandConfig.bcId (GUID).
 */
export function buildBcApiV2CompanyEntityUrl(
  baseUrl: string,
  companyId: string,
  entitySet: string,
  environment = DEFAULT_ENVIRONMENT,
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

async function fetchBcJsonCollection<T extends Record<string, unknown>>(
  connectionId: number,
  initialUrl: string,
  errorLabel: string,
): Promise<T[]> {
  const rows: T[] = [];
  // Every hop is checked, not just the first: `@odata.nextLink` comes back from
  // the remote and is followed with the bearer token attached.
  let url: string | null = assertApiDestination(initialUrl).toString();
  let retried401 = false;

  while (url) {
    const conn = await getBcConnectionById(connectionId);
    if (!conn) throw new Error("BC connection not found");

    let token = await getBcAccessToken(conn.Code);

    let res: Response;
    let transientRetries = 0;
    while (true) {
      try {
        res = await fetchBcGet(url, token);
      } catch (error) {
        if (transientRetries >= BC_GET_MAX_TRANSIENT_RETRIES) throw error;
        await wait(retryDelayMs(null, transientRetries));
        transientRetries += 1;
        continue;
      }

      if (res.status === 401 && !retried401) {
        retried401 = true;
        const refresh = await refreshBcConnectionToken(connectionId);
        if (!refresh.ok) throw new Error(refresh.message || "BC token refresh failed");
        token = await readBcToken(connectionId);
        continue;
      }

      const transientStatus = res.status === 408 || res.status === 429 || res.status >= 500;
      if (transientStatus && transientRetries < BC_GET_MAX_TRANSIENT_RETRIES) {
        await wait(retryDelayMs(res, transientRetries));
        transientRetries += 1;
        continue;
      }
      break;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `${errorLabel} ${res.status} [${url}]${text ? `: ${text.slice(0, 400)}` : ""}`,
      );
    }

    const json = (await res.json()) as Record<string, unknown>;
    const page = parseODataPage<T>(json);
    rows.push(...page.value);
    url = page.nextLink ? assertApiDestination(page.nextLink).toString() : null;
  }

  return rows;
}

function parseODataPage<T>(json: Record<string, unknown>): { value: T[]; nextLink: string | null } {
  const value = (json.value as T[] | undefined) ?? [];
  const next =
    (json["@odata.nextLink"] as string | undefined)
    ?? (json["odata.nextLink"] as string | undefined)
    ?? null;
  return { value, nextLink: next };
}

async function readBcToken(connectionId: number): Promise<string> {
  const row = await getBcConnectionById(connectionId);
  if (!row?.AccessTokenEnc) throw new Error("No BC access token available");
  return decryptPassword(row.AccessTokenEnc);
}

/** GET OData collection with auto token refresh (expiry + one 401 retry). */
export async function fetchBcODataCollection<T extends Record<string, unknown>>(
  connectionId: number,
  initialUrl: string,
): Promise<T[]> {
  return fetchBcJsonCollection<T>(connectionId, initialUrl, "BC OData error");
}

/** GET BC API v2.0 collection (companies GUID endpoints) with token refresh. */
export async function fetchBcApiV2Collection<T extends Record<string, unknown>>(
  connectionId: number,
  initialUrl: string,
): Promise<T[]> {
  return fetchBcJsonCollection<T>(connectionId, initialUrl, "BC API error");
}

function buildPpapJournalActionUrl(
  baseUrl: string,
  environment: "Production" | "Sandbox",
): string {
  const root = baseUrl.trim().replace(/\/+$/, "");
  const env = environment === "Sandbox" ? "Sandbox" : "Production";
  const envSegment = `/${env}`;

  if (root.toLowerCase().endsWith(envSegment.toLowerCase())) {
    return `${root}/ODataV4/PPAPJournalCreateAPI_CreateFromJson`;
  }

  if (!root.toLowerCase().includes(BC_HOST)) {
    throw new Error("BC Base URL must point to api.businesscentral.dynamics.com");
  }

  return `${root}${envSegment}/ODataV4/PPAPJournalCreateAPI_CreateFromJson`;
}

/**
 * POST custom PPAP journal API (CreateFromJson).
 * Body: { requestBody: "<json string>" }, header company: BC company GUID.
 */
/**
 * A BC journal post that came back with an HTTP error status.
 *
 * Carries the status because the caller has to tell two very different
 * outcomes apart. A 4xx is Business Central refusing the document — nothing was
 * created, and the batch may safely be corrected and sent again. A 5xx, or a
 * transport error (which never reaches this class at all, because `fetch`
 * rejects instead), leaves the remote outcome *unknown*: the journal may well
 * exist. `sendErpInterfaceBatch` holds such a batch instead of marking it
 * retryable, so an operator reconciles rather than the system posting twice.
 */
export class BcJournalPostError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BcJournalPostError";
  }

  /** True when BC definitively rejected the payload and created nothing. */
  get definitelyRejected(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export async function postBcPpapJournalCreateFromJson(
  connectionId: number,
  companyId: string,
  environment: "Production" | "Sandbox",
  baseUrl: string,
  innerPayload: Record<string, unknown>,
): Promise<unknown> {
  const company = companyId.trim();
  if (!company) throw new Error("BC Company Id is required");

  const url = assertApiDestination(buildPpapJournalActionUrl(baseUrl, environment)).toString();
  const body = JSON.stringify({ requestBody: JSON.stringify(innerPayload) });
  let retried401 = false;

  while (true) {
    const conn = await getBcConnectionById(connectionId);
    if (!conn) throw new Error("BC connection not found");

    let token = await getBcAccessToken(conn.Code);

    let res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        company,
      },
      body,
    });

    if (res.status === 401 && !retried401) {
      retried401 = true;
      const refresh = await refreshBcConnectionToken(connectionId);
      if (!refresh.ok) {
        throw new Error(refresh.message || "BC token refresh failed");
      }
      continue;
    }

    const text = await res.text().catch(() => "");

    if (!res.ok) {
      throw new BcJournalPostError(
        res.status,
        `BC journal API ${res.status}${text ? `: ${text.slice(0, 1500)}` : ""}`,
      );
    }

    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }
}
