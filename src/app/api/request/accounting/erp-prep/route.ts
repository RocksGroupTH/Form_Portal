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
import { resolveFormEnvironment } from "@/lib/form-environment";
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

    const [environment, access, deptCtx] = await Promise.all([
      resolveFormEnvironment(),
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

    // The environment this list resolved to — POST …/send is required to echo
    // it back unchanged. Under per-viewer UAT routing, two people can load this
    // same route into different databases; without this, the sender's own
    // cookie alone decided which Business Central instance a batch reached. See
    // "ERP send" in docs/superpowers/specs/2026-08-18-parallel-uat-design.md.
    //
    // No flat `requestIds` alongside it: what the send compares against is the
    // *batch* — one interface target, ready, not already Sent — which the
    // client narrows out of `rows` with `selectErpSendBatchRows`, the same
    // predicate the send applies. A duplicate list of every id in `rows` was
    // both redundant with `rows` and the wrong set to compare.
    return NextResponse.json({
      ok: true,
      data: {
        environment,
        rows: data,
      },
    });
  } catch (err) {
    console.error("[api/request/accounting/erp-prep] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
