import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { resolveApproverInterfaceAccess } from "@/lib/acc/approver-interface-access";

/**
 * GET /api/request/accounting/my-interface-access
 * Returns Interface ERP group visibility for the current user.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessAccountArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const access = await resolveApproverInterfaceAccess(
      session.user.email,
      session.user.role,
    );
    return NextResponse.json({ ok: true, data: access });
  } catch (err) {
    console.error("[api/request/accounting/my-interface-access] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
