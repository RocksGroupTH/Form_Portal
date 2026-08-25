import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listActiveApproversByRole } from "@/lib/adv/advance-approver-service";

/** GET — the first approval level (Head Accounting) for display on the request form. */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await listActiveApproversByRole("HEAD_ACC");
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/first-approvers] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
