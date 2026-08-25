import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listApproverCandidates } from "@/lib/adv/approver-candidates";

/** GET — eligible AP-2 approvers (active IT/Accounting employees). IT/System Admin only. */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const data = await listApproverCandidates();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/approvers/candidates] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
