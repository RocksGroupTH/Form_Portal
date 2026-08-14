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

  if (authResponse) {
    applySecurityHeaders(authResponse, isApiRoute);
    return authResponse;
  }

  // Forward the pathname to Node-side code. Per-form routing picks the database
  // from the URL and getFormPool() has no argument to receive it, so the path
  // has to arrive as a header — Next exposes request headers to server code but
  // not the pathname. Set from nextUrl, never trusted from the client: .set()
  // overwrites any x-pathname the caller supplied.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response, isApiRoute);
  return response;
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|brandlogo|codexfamilylogo).*)",
  ],
};
