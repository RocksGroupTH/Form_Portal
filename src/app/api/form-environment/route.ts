import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/api-auth";
import { getFormSwitchMap, resolveFormAccess } from "@/lib/form-environment";
import type { FormAccess, FormEnvironmentPayload, ViewerUatStatus } from "@/lib/form-environment/payload-types";
import { getActiveUatTester } from "@/lib/uat-tester/service";
import { UAT_MODE_COOKIE, isUatModeCookieOn } from "@/lib/uat-mode";
import { REQUEST_CARDS } from "@/lib/constants";

/**
 * GET — everything the UI needs to render an environment chip or filter a
 * catalogue for *this* viewer: which database each form resolves to for them
 * (`forms`), and their own UAT-tester standing (`viewer`).
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

    // Not just Object.keys(switches): a form with no FormEnvironment row is
    // known-Production (PRODUCTION_ONLY), not unknown — but getFormSwitchMap()
    // only returns forms that already have a row, and rows are created lazily
    // (setFormFlag's MERGE is the only writer; nothing seeds them). Reading
    // only the switch-map keys would drop the chip for an unconfigured form
    // entirely, and — worse — a UAT-mode viewer's `isFormAvailable` fallback
    // on the client defaults missing entries to `true`, which would offer a
    // form the resolver actually refuses. So the codes list is the union of
    // what has a row and every form code the UI can render a card for.
    const codes = Array.from(
      new Set([
        ...Object.keys(switches),
        ...REQUEST_CARDS.map((c) => c.badge).filter((b): b is string => !!b),
      ]),
    );
    const decisions = await Promise.all(codes.map((code) => resolveFormAccess(code)));
    const forms: Record<string, FormAccess> = {};
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
