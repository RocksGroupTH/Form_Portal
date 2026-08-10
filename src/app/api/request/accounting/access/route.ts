import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea, isAccApprover } from "@/lib/acc/access";

/* ── GET /api/request/accounting/access — viewer's accounting capabilities ── */

export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const role = session.user.role;
    const [account, approver] = await Promise.all([
      canAccessAccountArea(email, role),
      isAccApprover(email),
    ]);
    return NextResponse.json({ ok: true, data: { account, approver } });
  } catch (err) {
    console.error("[api/request/accounting/access] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
