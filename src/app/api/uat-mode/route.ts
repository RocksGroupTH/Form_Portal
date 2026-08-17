import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/api-auth";
import { getActiveUatTester } from "@/lib/uat-tester/service";
import { UAT_MODE_COOKIE, UAT_MODE_MAX_AGE } from "@/lib/uat-mode";

/**
 * POST { enabled: boolean } — sets or clears the per-browser UAT-mode cookie
 * for the signed-in viewer. This is the only place that writes
 * `UAT_MODE_COOKIE`; the navbar switch (`UatModeSwitch.tsx`) is its one caller.
 *
 * A route handler, not a server action: server actions are checked against
 * `PRODUCTION_HOSTS` in next.config.mjs, and a Form Portal host missing from
 * that allowlist would silently reject the action instead of failing loudly.
 * `cookies().set()` works from a route handler with no such gate.
 *
 * Refuses with 403 unless the caller resolves to an active row via
 * `getActiveUatTester` right now. The cookie itself is only ever a hint —
 * `viewerIsTesting()` (`src/lib/form-environment/index.ts`) re-checks tester
 * membership on every resolve, so a forged or stale cookie changes nothing
 * downstream — but there is no reason to *write* it for someone who is not
 * (or is no longer) an active tester.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled must be a boolean" }, { status: 400 });
  }

  const tester = await getActiveUatTester(session.user?.email ?? null);
  if (!tester) {
    return NextResponse.json({ ok: false, error: "Not an active UAT tester" }, { status: 403 });
  }

  const cookieStore = await cookies();
  if (enabled) {
    cookieStore.set(UAT_MODE_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: UAT_MODE_MAX_AGE,
    });
  } else {
    cookieStore.delete({ name: UAT_MODE_COOKIE, path: "/" });
  }

  return NextResponse.json({ ok: true, data: { uatMode: enabled } });
}
