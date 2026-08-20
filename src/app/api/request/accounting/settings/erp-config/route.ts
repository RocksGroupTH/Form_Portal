import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import {
  canRetargetClaimBrand,
  resolveApproverInterfaceAccess,
  INTERFACE_TARGET_SCOPE_ERROR,
} from "@/lib/acc/approver-interface-access";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import {
  clearBrandErpInterfaceTarget,
  getBrandErpConfigPage,
  updateBrandErpInterfaceTarget,
} from "@/lib/acc/brand-erp-config-service";
import { isAdminRole } from "@/lib/roles";

/**
 * Scope, not just the tab.
 *
 * `requireSettingsTab("erpInterface")` answers "may this person open the
 * Interface ERP tab". It does not answer "are these books theirs" — and
 * `AccApproverInterfaceBrand` answers exactly that for the ERP send, the prep
 * detail and the ACCOUNT approve/reject, off the same `AccApprover` row this
 * gate just matched. Without this, a KSI-scoped approver holding the grant was
 * brand-scoped when approving a claim and unscoped when deciding which Business
 * Central company that claim's journals post to.
 *
 * The admin arm is untouched: `isAdminRole` is the pair `requireRole` allowed
 * before Task 3b, and an admin is usually not an `AccApprover` at all, so
 * resolving their interface access would refuse them everything.
 *
 * Returns the refusal to send, or `null` to carry on. Called before the write,
 * so a refused request changes nothing.
 */
async function refuseOutOfInterfaceScope(
  session: Session,
  claimBrandCode: string,
  nextTarget: string | null,
): Promise<NextResponse | null> {
  if (isAdminRole(session.user.role)) return null;

  // Uppercased here, because that is how `upsertBrandErpInterfaceMap` stores it
  // and how `updateBrandErpInterfaceTarget` will look it up. Matching a
  // lower-case spelling only by grace of a case-insensitive collation would let
  // `pcth` resolve to "no current target" while the write repointed PCTH.
  const [access, current] = await Promise.all([
    resolveApproverInterfaceAccess(session.user.email, session.user.role),
    getBrandErpInterfaceMap(claimBrandCode.trim().toUpperCase()),
  ]);
  if (canRetargetClaimBrand(access, current?.interfaceBrandCode ?? null, nextTarget)) {
    return null;
  }
  return NextResponse.json(
    { ok: false, error: INTERFACE_TARGET_SCOPE_ERROR },
    { status: 403 },
  );
}

export async function GET() {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const data = await getBrandErpConfigPage();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/erp-config] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const brandCode = body.brandCode as string;
    if (!brandCode?.trim()) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุแบรนด์เบิก" }, { status: 400 });
    }

    const interfaceBrandCode = (body.interfaceBrandCode as string | null)?.trim() || null;
    if (!interfaceBrandCode) {
      return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์ปลายทาง" }, { status: 400 });
    }

    const refused = await refuseOutOfInterfaceScope(
      session,
      brandCode.trim(),
      interfaceBrandCode,
    );
    if (refused) return refused;

    const data = await updateBrandErpInterfaceTarget(
      brandCode.trim(),
      interfaceBrandCode,
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error("[api/request/accounting/settings/erp-config] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const brandCode = req.nextUrl.searchParams.get("brandCode")?.trim();
    if (!brandCode) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุแบรนด์เบิก" }, { status: 400 });
    }

    const refused = await refuseOutOfInterfaceScope(session, brandCode, null);
    if (refused) return refused;

    await clearBrandErpInterfaceTarget(brandCode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error("[api/request/accounting/settings/erp-config] DELETE", err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
