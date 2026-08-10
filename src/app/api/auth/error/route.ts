import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * NextAuth may send users to `/api/auth/error?error=...` before or instead of
 * the custom `pages.error` route in some cases. Send them to `/login` so the
 * app shows Thai messages via `?error=` (see `getLoginErrorMessage`).
 */
function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export function GET(request: NextRequest) {
  return redirectToLogin(request);
}

export function POST(request: NextRequest) {
  return redirectToLogin(request);
}
