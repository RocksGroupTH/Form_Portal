import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/acc/request-service";
import { canAccessAccountArea } from "@/lib/acc/access";
import {
  canActOnClaimBrand,
  INTERFACE_SCOPE_ERROR,
  resolveApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access";
import { interfaceByClaimMapToRecord, loadPrepDeptContext } from "@/lib/acc/erp-prep-service";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { buildAccActor } from "@/lib/acc/actor-context";
import { applyRateOverride } from "@/lib/acc/rate-override";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/**
 * POST /api/request/accounting/requests/[id]/exchange-rate
 * Body: `{ rate: number | string }`
 *
 * Accounting corrects the rate on a foreign AP-1 claim, while it is sitting at
 * the ACCOUNT step. Saving recomputes `ForeignAmount × rate` and rewrites
 * `AccRequest.TotalAmount`; a conversion that cannot be done refuses the save
 * rather than leaving the old baht figure beside a new rate.
 *
 * **Why this is a route of its own rather than a field on `approve`.** AP-1's
 * accounting approval is a *batch*: the queue fires `approve` per selected row
 * in a loop with one shared payment date, so a per-row rate has nowhere to go.
 * More to the point the correction must be visible **before** the approval is
 * pressed — the accountant is checking the baht figure, which is exactly what
 * the corrected rate changes. Its own route also means the approve gate is
 * reproduced, not touched: nothing here loosens what `approve` already
 * enforces.
 *
 * **The gate is the ACCOUNT branch of `approve`, verbatim.** Object ACL first
 * (`authorizeAccRequest`, pinned to AP-1 so an AP-4 claim parked on the same
 * (ManagerApproved, ACCOUNT) tuple 404s), then account-area membership, then
 * **interface scope** — a KSI-scoped approver must not rewrite the amount a
 * PCTH claim posts to Business Central, which is the same reason `approve`
 * checks it. The step itself is enforced in the UPDATE's own predicate, in
 * `applyRateOverride`, not by a prior read.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/accounting` prefix already
 * classifies `AP-1`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, id, "read", AP1_FORM_CODE);
  if (gate instanceof Response) return gate;

  const accReq = await getRequest(id);
  if (!accReq) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  if (!(await canAccessAccountArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const [access, deptCtx] = await Promise.all([
    resolveApproverInterfaceAccess(session.user.email, session.user.role),
    loadPrepDeptContext(accReq.formCode),
  ]);
  if (
    !canActOnClaimBrand(
      access,
      interfaceByClaimMapToRecord(deptCtx.interfaceByClaim),
      accReq.brandCode,
    )
  ) {
    return NextResponse.json({ ok: false, error: INTERFACE_SCOPE_ERROR }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { rate?: unknown };
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const data = await applyRateOverride(id, AP1_FORM_CODE, actor, body.rate);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "แก้อัตราแลกเปลี่ยนไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
