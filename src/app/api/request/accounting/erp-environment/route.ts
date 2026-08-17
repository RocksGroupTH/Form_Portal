import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveEffectiveErpEnvironment } from "@/lib/acc/erp-environment";
import type { ErpEnvironmentInfo } from "@/lib/acc/erp-environment-shared";

/**
 * GET /api/request/accounting/erp-environment
 * Effective BC environment for the current route/form (accounting UI banner).
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data: ErpEnvironmentInfo = {
      effectiveEnvironment: await resolveEffectiveErpEnvironment(),
    };
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/erp-environment] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
