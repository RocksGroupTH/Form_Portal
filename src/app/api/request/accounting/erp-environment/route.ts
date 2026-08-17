import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAppSetting } from "@/lib/app-settings";
import { getRequestHost, resolveEffectiveErpEnvironment } from "@/lib/acc/erp-environment";
import type { ErpBcEnvironment, ErpEnvironmentInfo } from "@/lib/acc/erp-environment-shared";
import { isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";
import { isSystemAdminRole } from "@/lib/roles";

/**
 * GET /api/request/accounting/erp-environment
 * Effective BC environment for the current user (navbar + accounting UI).
 *
 * `canUseSandbox`/`globalEnvironment` below read the old app-wide toggle's
 * stored AppSetting value directly — the shared helpers that used to compute
 * them were deleted from erp-environment.ts by "remove the global ERP
 * environment toggle", which left no write path for this setting. This route
 * and the `ErpEnvironmentInfo` fields it fills are trimmed down to just
 * `effectiveEnvironment` in the very next task ("reduce the ERP environment
 * payload to what the form decides"); until then this keeps the existing
 * contract compiling with unchanged behavior.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const role = session.user.role;
    const host = await getRequestHost();
    const sandboxHostAllowed = isErpSandboxHostAllowed(host);
    const canUseSandbox = sandboxHostAllowed && isSystemAdminRole(role);
    const [effectiveEnvironment, storedEnvironment] = await Promise.all([
      resolveEffectiveErpEnvironment(),
      canUseSandbox ? getAppSetting("ERP_INTERFACE_ENV") : Promise.resolve(null),
    ]);
    const globalEnvironment: ErpBcEnvironment =
      storedEnvironment === "Sandbox" ? "Sandbox" : "Production";

    const data: ErpEnvironmentInfo = {
      effectiveEnvironment,
      globalEnvironment: sandboxHostAllowed ? globalEnvironment : "Production",
      canUseSandbox,
      canConfigure: canUseSandbox,
      sandboxHostAllowed,
    };

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/erp-environment] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
