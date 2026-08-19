/**
 * The tester-only barrier on AP-17's by-id routes, as one call.
 *
 * AP-1 gets this through `authorizeAccRequest` (`@/lib/acc/request-acl`), which
 * already builds an actor and a viewer. AP-17's routes each resolve HR
 * themselves and have their own shape of ownership check, so they take the
 * barrier separately rather than being rewritten onto AP-1's ACL — the two forms
 * genuinely differ (AP-17 has an Admin stage and no ACCOUNT step) and merging
 * them for this would be a larger change than the finding calls for.
 *
 * Returns the 404 to send, or null to continue. See `assertUatActorAllowed` for
 * why it is a 404 and why membership rather than the cookie decides.
 */

import { NextResponse } from "next/server";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { assertUatActorAllowed } from "@/lib/uat-tester/guards";

export async function uatActorGate(session: {
  user: { email?: string | null };
}): Promise<Response | null> {
  const email = resolveLoginEmail(session.user, null, { email: session.user.email });

  let staffId: number | null = null;
  if (email) {
    // Swallowed on purpose: HR being unreachable must not turn a production
    // request into a 404. Outside UAT the guard below is a no-op anyway, and
    // inside it the email alone still resolves a tester (`getActiveUatTesterFor`
    // falls back to the address).
    try {
      staffId = (await findActiveEmployeeByEmail(email)).employee?.staffId ?? null;
    } catch {
      staffId = null;
    }
  }

  try {
    await assertUatActorAllowed(email, staffId);
    return null;
  } catch {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
}
