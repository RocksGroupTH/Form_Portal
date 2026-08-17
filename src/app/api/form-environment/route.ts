import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/api-auth";
import { getFormSwitchMap, resolveFormAccess, type EnvironmentDecision } from "@/lib/form-environment";
import { getActiveUatTester } from "@/lib/uat-tester/service";
import { UAT_MODE_COOKIE, isUatModeCookieOn } from "@/lib/uat-mode";

/**
 * The viewer's own UAT-tester standing — separate from any one form, and
 * what the navbar switch (see plan Task 7) renders from.
 */
export interface ViewerUatStatus {
  /** Has an active row in UatTester, whether or not UAT mode is on right now. */
  isTester: boolean;
  /** Cookie on AND an active tester — the effective mode every write choke point honours. */
  uatMode: boolean;
  /** Whether any form has its UAT switch on, for anybody — not just this viewer. */
  anyUatForm: boolean;
  /** The viewer's own tester row names a manager. */
  hasUatManager: boolean;
}

export interface FormEnvironmentPayload {
  viewer: ViewerUatStatus;
  forms: Record<string, EnvironmentDecision>;
}

/**
 * GET — everything the UI needs to render an environment chip or filter a
 * catalogue for *this* viewer: which database each form resolves to for them
 * (`forms`, one entry per code in the switch map, via `resolveFormAccess`),
 * and their own UAT-tester standing (`viewer`).
 *
 * Now that Production and UAT run side by side the answer is per-viewer: an
 * ordinary user sees Production for everything, a tester in UAT mode sees UAT
 * for the forms open to testing. Readable by any signed-in user, unlike
 * /api/settings/form-environment: this one only says where the caller's own
 * requests land, which is what every badge and catalogue filter needs.
 * Changing a switch stays System Admin only.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const email = session.user?.email ?? null;
    const [switches, tester, cookieStore] = await Promise.all([
      getFormSwitchMap(),
      getActiveUatTester(email),
      cookies(),
    ]);

    const codes = Object.keys(switches);
    const decisions = await Promise.all(codes.map((code) => resolveFormAccess(code)));
    const forms: Record<string, EnvironmentDecision> = {};
    codes.forEach((code, i) => {
      forms[code] = decisions[i];
    });

    const viewer: ViewerUatStatus = {
      isTester: tester !== null,
      uatMode: tester !== null && isUatModeCookieOn(cookieStore.get(UAT_MODE_COOKIE)?.value ?? null),
      anyUatForm: Object.values(switches).some((s) => s.uatEnabled),
      hasUatManager: tester?.managerStaffId != null,
    };

    const data: FormEnvironmentPayload = { viewer, forms };
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/form-environment] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
