import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import {
  filterRowsForInterfaceAccess,
  resolveApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access";
import {
  interfaceByClaimMapToRecord,
  listErpPrepRows,
  loadPrepDeptContext,
  type ErpPrepFilters,
} from "@/lib/acc/erp-prep-service";
import type { ErpPrepStatus } from "@/features/accounting/constants";
import { ERP_PREP_STATUSES } from "@/features/accounting/constants";

/**
 * GET /api/request/accounting/erp-prep
 * Approved requests prepared for future ERP interface (accounting area only).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessAccountArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const rawPrep = sp.get("prepStatus");
    const prepStatus =
      rawPrep && (ERP_PREP_STATUSES as readonly string[]).includes(rawPrep)
        ? (rawPrep as ErpPrepStatus)
        : null;

    const filters: ErpPrepFilters = {
      brandCode: sp.get("brandCode") ?? null,
      prepStatus,
      paymentFrom: sp.get("paymentFrom") ?? null,
      paymentTo: sp.get("paymentTo") ?? null,
      travelFrom: sp.get("travelFrom") ?? null,
      travelTo: sp.get("travelTo") ?? null,
    };

    const [access, deptCtx] = await Promise.all([
      resolveApproverInterfaceAccess(session.user.email, session.user.role),
      loadPrepDeptContext(),
    ]);

    let data = await listErpPrepRows(filters, { deptCtx });

    if (!access.allAccess) {
      data = filterRowsForInterfaceAccess(
        data,
        interfaceByClaimMapToRecord(deptCtx.interfaceByClaim),
        access,
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/erp-prep] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
