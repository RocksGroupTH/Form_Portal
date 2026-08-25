import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listAdvanceApprovers,
  upsertAdvanceApprover,
  isAdvanceApproverRole,
} from "@/lib/adv/advance-approver-service";
import { listApproverCandidates } from "@/lib/adv/approver-candidates";
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

/**
 * POST — upsert an approver.
 * Body: { id?, email, approverRole: 'HEAD_ACC'|'ACC_OFFICER', displayName?, isActive? }
 * New approvers may only be added from IT/Accounting (listApproverCandidates).
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();

    // A role/active toggle carries { id, ... } — don't demand role/email there.
    const isEdit = !!body.id;
    if (!isEdit && !body.email) {
      return NextResponse.json({ ok: false, error: "ต้องระบุอีเมล" }, { status: 400 });
    }
    if (body.approverRole !== undefined && !isAdvanceApproverRole(body.approverRole)) {
      return NextResponse.json({ ok: false, error: "ระดับผู้อนุมัติไม่ถูกต้อง" }, { status: 400 });
    }
    if (!isEdit && !body.approverRole) {
      return NextResponse.json(
        { ok: false, error: "ต้องเลือกระดับ (Head Accounting / Accounting Officer)" },
        { status: 400 },
      );
    }

    // New approvers must be from IT/Accounting — resolve StaffId + name from the
    // candidate list so the picker and the stored row can't drift apart.
    if (!isEdit && body.email) {
      const candidates = await listApproverCandidates();
      const match = candidates.find(
        (c) => c.email.toLowerCase() === String(body.email).trim().toLowerCase(),
      );
      if (!match) {
        return NextResponse.json(
          { ok: false, error: "อีเมลนี้ไม่ได้อยู่ในแผนกบัญชีหรือ IT — เลือกจากรายชื่อที่กำหนด" },
          { status: 400 },
        );
      }
      body.staffId = match.staffId;
      if (!body.displayName) body.displayName = match.fullName;
      if (!body.photoUrl) body.photoUrl = match.photoUrl ?? undefined;
    }

    // Fallback name resolution for a bare email edit (rare).
    if (!body.staffId && body.email) {
      try {
        const { employee } = await findActiveEmployeeByEmail(body.email);
        if (employee?.staffId) {
          body.staffId = employee.staffId;
          if (!body.displayName && employee.fullName) body.displayName = employee.fullName;
        }
      } catch {
        /* best-effort */
      }
    }

    await upsertAdvanceApprover(body, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/approvers] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
