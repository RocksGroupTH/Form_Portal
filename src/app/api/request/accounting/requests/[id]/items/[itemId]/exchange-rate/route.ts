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
import { applyLineRateOverride } from "@/lib/acc/line-rate-override";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/**
 * POST /api/request/accounting/requests/[id]/items/[itemId]/exchange-rate
 * Body: `{ rate: number | string }`
 *
 * Accounting corrects the rate on **one foreign expense line** of an AP-1
 * claim, while it is sitting at the ACCOUNT step. Saving recomputes that line's
 * `ForeignAmount × rate` into its `Amount` and rewrites the claim's stored
 * totals from the lines; a conversion that cannot be done refuses the save
 * rather than leaving the old baht figure beside a new rate.
 *
 * **Why a per-line route rather than the request-level one next door.**
 * Migration 129 moved AP-1's currency onto the expense line, and no AP-1 write
 * records a header currency any more — so `.../requests/[id]/exchange-rate`,
 * which reads those columns, stopped rendering for every AP-1 claim filed
 * since. That route is not replaced: AP-17's booking desk records a header
 * currency legitimately, and AP-1 claims filed during migration 125's design
 * still carry one.
 *
 * **Why a route of its own rather than a field on `approve`.** AP-1's
 * accounting approval is a *batch*: the queue fires `approve` per selected row
 * in a loop with one shared payment date, so a per-row — let alone a per-line —
 * rate has nowhere to go. More to the point the correction must be visible
 * **before** the approval is pressed, because the baht figure is exactly what
 * the accountant is checking.
 *
 * **The gate is the ACCOUNT branch of `approve`, verbatim**, and identical to
 * the request-level override's: object ACL first (`authorizeAccRequest`, pinned
 * to AP-1 so an AP-4 claim parked on the same (ManagerApproved, ACCOUNT) tuple
 * 404s), then account-area membership, then **interface scope** — a KSI-scoped
 * approver must not rewrite the amount a PCTH claim posts to Business Central.
 * Nothing here loosens what `approve` already enforces. The step itself is
 * enforced in the UPDATE predicates, in `applyLineRateOverride`, not by a prior
 * read.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/accounting` prefix already
 * classifies `AP-1`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId, itemId: rawItemId } = await params;
  const id = Number(rawId);
  const itemId = Number(rawItemId);
  if (Number.isNaN(id) || Number.isNaN(itemId)) {
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
    const data = await applyLineRateOverride(id, itemId, AP1_FORM_CODE, actor, body.rate);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "แก้อัตราแลกเปลี่ยนไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
