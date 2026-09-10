import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { buildAccActor } from "@/lib/acc/actor-context";
import { setReimbursePaymentDate } from "@/lib/acc/reimburse/approval-service";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * POST /api/request/reimburse/requests/[id]/payment-date  { date: "YYYY-MM-DD" }
 *
 * Sets a claim's payment date without approving it, so the accounting queue can
 * save one the moment it is picked. Before this, `PaymentDate` had exactly one
 * writer — the approval itself — so a date lived in the browser until the
 * accountant approved, and a reload lost every date they had chosen. AP-17 has
 * had this endpoint for the same reason.
 *
 * **The step does not move.** The claim stays at `(ManagerApproved, ACCOUNT)`
 * and still has to be approved; that is what makes this safe to call as often
 * as a field changes.
 *
 * Layered exactly as `../items` is, and for the reasons its docblock gives:
 * `authorizeAccRequest("read")` first — it confirms the row exists, pins it to
 * AP-4, and applies the UAT-tester barrier with its 404 — then the roster and
 * brand-scope checks inside `setReimbursePaymentDate`, because the `"read"`
 * verdict alone also admits AP-1's shared `AccApprover` roster. `"mutate"` is
 * the wrong mode here for the same reason it is wrong there: it is
 * creator-and-`Draft`/`Returned`-only, and would refuse every legitimate
 * approver.
 *
 * `ROUTE_RULES` needs no entry — `/api/request/reimburse` already classifies
 * AP-4.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, id, "read", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => null)) as { date?: unknown } | null;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  try {
    // The date itself is validated in the service, against the same
    // `paymentDateProblem` bound the approval applies — one rule, so the two
    // cannot come to disagree about which dates are acceptable.
    await setReimbursePaymentDate(id, actor, body?.date);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
