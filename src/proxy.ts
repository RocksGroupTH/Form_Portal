import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const { auth } = NextAuth(authConfig);

type AuthMiddleware = (
  req: NextRequest
) => Promise<NextResponse | Response | undefined>;

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const PAGE_CSP = "frame-ancestors 'self'";

function applySecurityHeaders(res: NextResponse | Response, isApiRoute: boolean) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(key, value);
  }
  if (!isApiRoute) {
    res.headers.set("Content-Security-Policy", PAGE_CSP);
  }
}

/** True when the auth middleware is deciding the request rather than passing it on. */
function isAuthDecision(res: NextResponse | Response): boolean {
  return res.status !== 200 || res.headers.has("location") || res.headers.has("x-middleware-rewrite");
}

export default async function proxy(req: NextRequest) {
  const isApiRoute = req.nextUrl.pathname.startsWith("/api/");

  let authResponse: NextResponse | Response | undefined;
  try {
    authResponse = await (auth as unknown as AuthMiddleware)(req);
  } catch (err) {
    if (process.env.NODE_ENV === "development") console.error("[Proxy] auth error:", err);
    const redirect = NextResponse.redirect(new URL("/login", req.url));
    applySecurityHeaders(redirect, isApiRoute);
    return redirect;
  }

  // A redirect or rewrite is auth turning the request away — its call, not ours.
  if (authResponse && isAuthDecision(authResponse)) {
    applySecurityHeaders(authResponse, isApiRoute);
    return authResponse;
  }

  // Forward the pathname to Node-side code. Per-form routing picks the database
  // from the URL and getFormPool() has no argument to receive it, so the path
  // has to arrive as a header — Next exposes request headers to server code but
  // not the pathname. Set from nextUrl, never trusted from the client: .set()
  // overwrites any x-pathname the caller supplied.
  //
  // This has to happen on the way through even when auth returned a response.
  // NextAuth answers every allowed request with a pass-through 200, so an early
  // `return authResponse` here means the header is never attached and every
  // form resolves to Production — which is exactly what happened between
  // 2026-08-14 and 2026-08-18.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Keep whatever auth set on its pass-through — session rotation lives in
  // those cookies, and dropping them logs people out.
  if (authResponse) {
    for (const cookie of authResponse.headers.getSetCookie()) {
      response.headers.append("set-cookie", cookie);
    }
  }

  applySecurityHeaders(response, isApiRoute);
  return response;
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|brandlogo|codexfamilylogo).*)",
  ],
};
