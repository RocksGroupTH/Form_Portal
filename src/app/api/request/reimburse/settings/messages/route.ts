import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { messageBodyProblem } from "@/lib/form-environment/form-message-text";
import { getFormMessage, setFormMessage } from "@/lib/form-environment/form-message";

/**
 * AP-4's notice copy — the box at the top of the staff-reimbursement form.
 *
 * **`FORM_CODE` is a literal and is never read from the body.** Which form a
 * route governs is a property of the route, the same rule `requireSettingsTab`
 * states for its tab key; a posted form code would let this route rewrite
 * another form's notice.
 *
 * **Admin-only rather than tab-granted, and the reason is storage rather than
 * risk.** A message grants nothing — no approval, no posting target, no read.
 * But `AccReimburseAccessTab` is shared with the ACC Portal sibling, whose own
 * save deletes every row for an approver and re-inserts only the keys its list
 * knows, so a `messages` grant would vanish on that app's next save with no
 * error either side. Making it grantable means adding the key to both
 * applications in one change. See spec §8.
 *
 * The rows live in `Fast_Core`, reached through `getCorePool()`, so this route
 * needs no `ROUTE_RULES` entry and is unaffected by the settings prefix being
 * pinned to Production.
 */
const FORM_CODE = "AP-4";

export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
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
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    const text = typeof body?.body === "string" ? body.body : "";
    const problem = messageBodyProblem(text);
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
    await setFormMessage(FORM_CODE, text, session.user?.email ?? null);
    return NextResponse.json({ ok: true, data: await getFormMessage(FORM_CODE) });
  } catch (err) {
    console.error("[api/request/reimburse/settings/messages] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
