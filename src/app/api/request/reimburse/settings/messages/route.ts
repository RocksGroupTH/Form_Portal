import { NextRequest, NextResponse } from "next/server";
import { requireReimburseMessageAccess } from "@/lib/acc/reimburse/require-reimburse-message-access";
import { messageBodyProblem } from "@/lib/form-environment/form-message-text";
import { getFormMessage, setFormMessage } from "@/lib/form-environment/form-message";

/**
 * AP-4's notice copy — the box at the top of the staff-reimbursement form.
 *
 * **`FORM_CODE` is a literal and is never read from the body.** Which form a
 * route governs is a property of the route, the same rule `requireReimburseSettingsTab`
 * states for its tab key; a posted form code would let this route rewrite
 * another form's notice.
 *
 * **Gated on `AccReimburseAccess.CanMessage` (migration 166), a COLUMN, not a
 * `TabKey` grant — and that is storage, not risk.** A message grants nothing —
 * no approval, no posting target, no read. But `AccReimburseAccessTab` is
 * shared with the ACC Portal sibling, whose own save deletes every row for an
 * approver and re-inserts only the keys its list knows, so a `messages` grant
 * stored THERE would vanish on that app's next save with no error either side.
 * `CanMessage` is a column that saver's explicit column list never names, so it
 * survives. See `@/lib/acc/message-grant` and `requireReimburseMessageAccess`'s
 * own docblock. `messages` therefore stays out of `GRANTABLE_REIMBURSE_TABS` —
 * that list is `TabKey` grants only — even though this route is no longer
 * admin-only.
 *
 * The rows live in `Fast_Core`, reached through `getCorePool()`, so this route
 * needs no `ROUTE_RULES` entry and is unaffected by the settings prefix being
 * pinned to Production.
 */
const FORM_CODE = "AP-4";

export async function GET() {
  const session = await requireReimburseMessageAccess();
  if (session instanceof Response) return session;
  try {
    const row = await getFormMessage(FORM_CODE);
    return NextResponse.json({ ok: true, data: row ?? { body: "", updatedBy: null, updatedAt: null } });
  } catch (err) {
    console.error("[api/request/reimburse/settings/messages] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireReimburseMessageAccess();
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    // Absent and explicit-empty must not collapse into the same thing: an
    // explicit "" legitimately means "show no notice" (an admin's decision),
    // while a malformed or field-less POST is not that decision and must not
    // silently clear a form's notice with nothing to undo it — FormMessage
    // keeps no change log. Same distinction the API-key PATCH's `expiresAt`
    // and AP-17's `roomShareHostRequestId` draw for the same reason.
    if (typeof body?.body !== "string") {
      return NextResponse.json({ ok: false, error: "body is required" }, { status: 400 });
    }
    const text = body.body;
    const problem = messageBodyProblem(text);
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
    await setFormMessage(FORM_CODE, text, session.user?.email ?? null);
    return NextResponse.json({ ok: true, data: await getFormMessage(FORM_CODE) });
  } catch (err) {
    console.error("[api/request/reimburse/settings/messages] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
