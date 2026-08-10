/**
 * Microsoft Graph API — Client Credentials Flow
 *
 * Uses the same Azure AD app registration as auth.
 * Requires "Mail.Send" application permission (admin-consented).
 */

import { env } from "@/env";

/* ── Token cache ── */

let cachedToken: { token: string; expiresAt: number } | null = null;
let tokenPromise: Promise<string> | null = null;

export async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  // Prevent concurrent token fetches
  if (tokenPromise) return tokenPromise;

  tokenPromise = fetchToken().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

async function fetchToken(): Promise<string> {
  const tenantId = env.AZURE_AD_TENANT_ID;
  const clientId = env.AZURE_AD_CLIENT_ID;
  const clientSecret = env.AZURE_AD_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Azure AD credentials not configured for Graph API");
  }

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;

  cachedToken = {
    token: data.access_token as string,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };

  return cachedToken.token;
}

/* ── Send email ── */

interface Attachment {
  name: string;
  contentType: string;
  contentBase64: string;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  bodyHtml: string;
  cc?: string[];
  attachments?: Attachment[];
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const from = env.GRAPH_MAIL_FROM;
  if (!from) {
    console.warn("[Graph] GRAPH_MAIL_FROM not configured — skipping email");
    return;
  }

  const token = await getGraphToken();

  const message = {
    message: {
      subject: options.subject,
      body: {
        contentType: "HTML",
        content: options.bodyHtml,
      },
      toRecipients: [{ emailAddress: { address: options.to } }],
      ...(options.cc && options.cc.length > 0
        ? { ccRecipients: options.cc.map((addr) => ({ emailAddress: { address: addr } })) }
        : {}),
      ...(options.attachments && options.attachments.length > 0
        ? {
            attachments: options.attachments.map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.name,
              contentType: a.contentType,
              contentBytes: a.contentBase64,
            })),
          }
        : {}),
    },
    saveToSentItems: false,
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${text}`);
  }
}

/* ── Search AD users ── */

interface ADUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
}

export async function searchADUsers(query: string, top = 20): Promise<ADUser[]> {
  const token = await getGraphToken();

  const filter = `startswith(displayName,'${query.replace(/'/g, "''")}') or startswith(mail,'${query.replace(/'/g, "''")}') or startswith(userPrincipalName,'${query.replace(/'/g, "''")}')`;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users?$filter=${encodeURIComponent(filter)}&$select=id,displayName,mail,userPrincipalName,jobTitle,department&$top=${top}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph user search failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return (data.value ?? []) as ADUser[];
}

export async function getADUserPhoto(userId: string): Promise<string | null> {
  try {
    const token = await getGraphToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}/photos/48x48/$value`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function getADUserByEmail(email: string): Promise<ADUser | null> {
  const token = await getGraphToken();
  const escaped = email.replace(/'/g, "''");
  const filter = `mail eq '${escaped}' or userPrincipalName eq '${escaped}'`;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users?$filter=${encodeURIComponent(filter)}&$select=id,displayName,mail,userPrincipalName,jobTitle,department&$top=1`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) return null;
  const data = await res.json();
  return (data.value ?? [])[0] ?? null;
}
