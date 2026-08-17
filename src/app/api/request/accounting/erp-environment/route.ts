import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  canUseErpSandboxEnvironment,
  getGlobalErpInterfaceEnvironment,
  getRequestHost,
  resolveEffectiveErpEnvironment,
} from "@/lib/acc/erp-environment";
import type { ErpEnvironmentInfo } from "@/lib/acc/erp-environment-shared";
import { isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";

/**
 * GET /api/request/accounting/erp-environment
 * Effective BC environment for the current user (navbar + accounting UI).
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const role = session.user.role;
    const host = await getRequestHost();
    const sandboxHostAllowed = isErpSandboxHostAllowed(host);
    const canUseSandbox = canUseErpSandboxEnvironment(role, host);
    const [effectiveEnvironment, globalEnvironment] = await Promise.all([
      resolveEffectiveErpEnvironment(),
      canUseSandbox ? getGlobalErpInterfaceEnvironment() : Promise.resolve("Production" as const),
    ]);

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
