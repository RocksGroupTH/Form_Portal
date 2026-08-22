import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { getErpPrepDetail } from "@/lib/acc/erp-prep-service";
import {
  canActOnClaimBrand,
  INTERFACE_SCOPE_ERROR,
  resolveApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access";
import {
  interfaceByClaimMapToRecord,
  loadPrepDeptContext,
} from "@/lib/acc/erp-prep-service";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/**
 * GET /api/request/accounting/erp-prep/[id]
 * Prep detail + ERP payload preview for one approved request.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessAccountArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const data = await getErpPrepDetail(id);
    if (!data) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    // The list this detail is opened from filters by interface brand; opening a
    // row by id skipped that filter entirely, so an out-of-scope approver could
    // read another interface group's payload preview — accounts, dimensions,
    // amounts and requester names — by incrementing the number in the URL.
    const [access, deptCtx] = await Promise.all([
      resolveApproverInterfaceAccess(session.user.email, session.user.role),
      // AP-1: this is the detail behind the AP-1 prep queue, and
      // `getErpPrepDetail` above resolves its dimensions for AP-1 too.
      loadPrepDeptContext(AP1_FORM_CODE),
    ]);
    if (!canActOnClaimBrand(access, interfaceByClaimMapToRecord(deptCtx.interfaceByClaim), data.brandCode)) {
      return NextResponse.json({ ok: false, error: INTERFACE_SCOPE_ERROR }, { status: 403 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/erp-prep/[id]] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
