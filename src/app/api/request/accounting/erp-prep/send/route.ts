import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { sendErpInterfaceBatch } from "@/lib/acc/erp-interface-send";
import {
  filterRowsForInterfaceAccess,
  resolveApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access";
import {
  interfaceByClaimMapToRecord,
  listErpPrepRows,
  loadPrepDeptContext,
} from "@/lib/acc/erp-prep-service";
import { resolveFormEnvironment } from "@/lib/form-environment";

/**
 * Shown when a POST disagrees with the server's own resolve — either the
 * echoed environment or the echoed id set no longer matches. The remedy is
 * the same either way: reload, which re-fetches GET against whichever
 * environment this viewer now resolves to.
 */
const QUEUE_STALE_ERROR = "คิวที่คุณเห็นเป็นของอีกสภาพแวดล้อมหนึ่งแล้ว — โหลดหน้าใหม่";

/** Order-independent equality — the client must echo the same set it was given, not a superset or subset. */
function sameIdSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) {
    if (!set.has(id)) return false;
  }
  return true;
}

/**
 * POST /api/request/accounting/erp-prep/send
 * Send all ready documents for an interface target to Business Central (PPAP CreateFromJson).
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessAccountArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as {
      interfaceTarget?: string;
      environment?: string;
      requestIds?: unknown;
    };

    const interfaceTarget = body.interfaceTarget?.trim().toUpperCase() ?? "";

    if (!interfaceTarget) {
      return NextResponse.json(
        { ok: false, error: "ต้องระบุ interfaceTarget" },
        { status: 400 },
      );
    }

    const echoedEnvironment = body.environment;
    const echoedRequestIds = Array.isArray(body.requestIds)
      ? body.requestIds.filter(
          (id): id is number => typeof id === "number" && Number.isFinite(id),
        )
      : null;

    if (!echoedEnvironment || !echoedRequestIds) {
      return NextResponse.json(
        { ok: false, error: "ต้องระบุ environment และ requestIds ของคิวที่คุณเห็น" },
        { status: 400 },
      );
    }

    // The server's own resolve, recomputed the same way GET computed it — the
    // click must be bound to what was actually displayed, not to whichever
    // database the sender's own cookie or a stale tab happens to resolve to
    // right now. A tester in UAT mode and an ordinary user hitting this route
    // at the same moment must never be able to steer each other's batch into
    // the wrong Business Central instance.
    const [environment, access, deptCtx] = await Promise.all([
      resolveFormEnvironment(),
      resolveApproverInterfaceAccess(session.user.email, session.user.role),
      loadPrepDeptContext(),
    ]);

    let currentRows = await listErpPrepRows({}, { deptCtx });
    if (!access.allAccess) {
      currentRows = filterRowsForInterfaceAccess(
        currentRows,
        interfaceByClaimMapToRecord(deptCtx.interfaceByClaim),
        access,
      );
    }
    const currentRequestIds = currentRows.map((r) => r.id);

    if (
      environment !== echoedEnvironment ||
      !sameIdSet(currentRequestIds, echoedRequestIds)
    ) {
      return NextResponse.json({ ok: false, error: QUEUE_STALE_ERROR }, { status: 409 });
    }

    const data = await sendErpInterfaceBatch({
      interfaceTarget,
      userId: Number(session.user.id),
    });

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";
    console.error("[api/request/accounting/erp-prep/send] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
