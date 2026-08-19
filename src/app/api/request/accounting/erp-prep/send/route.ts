import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import {
  ErpQueueDriftError,
  ErpReconciliationRequiredError,
  sendErpInterfaceBatch,
} from "@/lib/acc/erp-interface-send";
import {
  canActOnInterfaceTarget,
  INTERFACE_SCOPE_ERROR,
  resolveApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access";
import { resolveFormEnvironment } from "@/lib/form-environment";

/**
 * The viewer's database moved between the GET that drew the page and the click
 * — they turned UAT mode on or off, or the form's flag changed under them. The
 * queue on screen belongs to the other database, so nothing on it can be sent
 * from here.
 *
 * Kept strictly separate from `ERP_QUEUE_DRIFT_ERROR`: a queue that merely
 * gained a row is a far more common and far less alarming event, and telling
 * an operator their environment changed when it did not sends them hunting for
 * a problem that does not exist.
 */
const ENVIRONMENT_STALE_ERROR = "คิวที่คุณเห็นเป็นของอีกสภาพแวดล้อมหนึ่งแล้ว — โหลดหน้าใหม่";

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

    // Scope, not just area. `canAccessAccountArea` above says "you work in
    // accounting"; this says "these books are yours". The list endpoint already
    // filtered its rows by interface brand, but this route accepted any target
    // an accounting actor named — so a KSI-only approver could send PCTH's
    // journals to PCTH's Business Central company.
    const access = await resolveApproverInterfaceAccess(session.user.email, session.user.role);
    if (!canActOnInterfaceTarget(access, interfaceTarget)) {
      return NextResponse.json({ ok: false, error: INTERFACE_SCOPE_ERROR }, { status: 403 });
    }

    // The server's own resolve. The click must be bound to the database that
    // was actually displayed, not to whichever one the sender's cookie happens
    // to resolve to now: a tester in UAT mode and an ordinary user hitting this
    // route at the same moment must never be able to steer each other's batch
    // into the wrong Business Central instance. The echoed value gates this
    // comparison only — `sendErpInterfaceBatch` still resolves its own pool, so
    // a forged body can cause a 409 but never a write to another database.
    const environment = await resolveFormEnvironment();
    if (environment !== echoedEnvironment) {
      return NextResponse.json(
        { ok: false, error: ENVIRONMENT_STALE_ERROR },
        { status: 409 },
      );
    }

    // The id comparison lives inside `sendErpInterfaceBatch`, which already
    // reads and narrows the queue; doing it here as well meant running that
    // heavy query twice per click, against a wider set than the send actually
    // touches. It throws `ErpQueueDriftError` before anything is written.
    const data = await sendErpInterfaceBatch({
      interfaceTarget,
      userId: Number(session.user.id),
      expectedRequestIds: echoedRequestIds,
    });

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof ErpQueueDriftError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    // The documents may be in Business Central. 409 so the client reloads and
    // shows the held batch, rather than 400's retry affordance — a retry here is
    // the one thing that must not happen.
    if (err instanceof ErpReconciliationRequiredError) {
      console.error("[api/request/accounting/erp-prep/send] unresolved remote outcome:", err.detail);
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";
    console.error("[api/request/accounting/erp-prep/send] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
