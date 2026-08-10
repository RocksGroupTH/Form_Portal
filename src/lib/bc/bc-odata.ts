/**
 * Business Central OData URL helpers and authenticated fetch (with token refresh).
 */

import { decryptPassword } from "@/lib/db/connection-crypto";
import {
  getBcConnectionById,
  getBcAccessToken,
  refreshBcConnectionToken,
} from "@/lib/bc/bc-connection";

const BC_HOST = "api.businesscentral.dynamics.com";
const DEFAULT_ENVIRONMENT = "Production";

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
  let url: string | null = initialUrl;
  let retried401 = false;

  while (url) {
    const conn = await getBcConnectionById(connectionId);
    if (!conn) throw new Error("BC connection not found");

    let token = await getBcAccessToken(conn.Code);

    let res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (res.status === 401 && !retried401) {
      retried401 = true;
      const refresh = await refreshBcConnectionToken(connectionId);
      if (!refresh.ok) {
        throw new Error(refresh.message || "BC token refresh failed");
      }
      token = await readBcToken(connectionId);
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `${errorLabel} ${res.status}${text ? `: ${text.slice(0, 400)}` : ""}`,
      );
    }

    const json = (await res.json()) as Record<string, unknown>;
    const page = parseODataPage<T>(json);
    rows.push(...page.value);
    url = page.nextLink;
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
export async function postBcPpapJournalCreateFromJson(
  connectionId: number,
  companyId: string,
  environment: "Production" | "Sandbox",
  baseUrl: string,
  innerPayload: Record<string, unknown>,
): Promise<unknown> {
  const company = companyId.trim();
  if (!company) throw new Error("BC Company Id is required");

  const url = buildPpapJournalActionUrl(baseUrl, environment);
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
      throw new Error(
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
