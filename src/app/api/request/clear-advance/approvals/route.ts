import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { isClrApprover } from "@/lib/clr/clear-advance-approver-service";
import { listApprovalQueue } from "@/lib/clr/clear-advance-admin-service";

/** GET /api/request/clear-advance/approvals?step=ACCOUNT|HEAD — AP-3 approval queue */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const email = session.user.email ?? null;
  const allowed =
    (await canAccessAccountArea(email, session.user.role)) ||
    (await isClrApprover(email, "ACCOUNT")) ||
    (await isClrApprover(email, "HEAD"));
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const step = req.nextUrl.searchParams.get("step");
    const data = await listApprovalQueue(step);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
