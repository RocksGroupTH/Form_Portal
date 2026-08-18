import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listAdvanceApprovers,
  upsertAdvanceApprover,
} from "@/lib/adv/advance-approver-service";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";

/** GET — full AP-2 approver list (incl. inactive). IT/System Admin only. */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const data = await listAdvanceApprovers();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/approvers] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST — upsert an approver. Body: { id?, email, displayName?, isActive? }. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    if (!body.id && !body.email) {
      return NextResponse.json({ ok: false, error: "ต้องระบุอีเมล" }, { status: 400 });
    }
    // Resolve HR StaffId + name from email when adding (mirrors AP-1).
    if (!body.staffId && body.email) {
      try {
        const { employee } = await findActiveEmployeeByEmail(body.email);
        if (employee?.staffId) {
          body.staffId = employee.staffId;
          if (!body.displayName && employee.fullName) body.displayName = employee.fullName;
        }
      } catch {
        /* HR lookup is best-effort — don't block adding the approver */
      }
    }
    await upsertAdvanceApprover(body, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/approvers] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
