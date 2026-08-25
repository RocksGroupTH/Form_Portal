import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { findActiveEmployeeByStaffId } from "@/lib/hr/employee-lookup";

/** GET /api/request/advance/employee?staffId=X — HR auto-fill for the entered code. */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const staffId = Number(req.nextUrl.searchParams.get("staffId"));
  if (!staffId || Number.isNaN(staffId)) {
    return NextResponse.json({ ok: false, error: "ระบุรหัสพนักงาน" }, { status: 400 });
  }

  try {
    const e = await findActiveEmployeeByStaffId(staffId);
    if (!e) return NextResponse.json({ ok: false, error: "ไม่พบพนักงานรหัสนี้ในระบบ HR" }, { status: 404 });
    const fullName = [e.firstName, e.lastName].filter(Boolean).join(" ") || e.fullName || null;
    return NextResponse.json({
      ok: true,
      data: {
        staffId: e.staffId,
        fullName,
        position: e.position ?? null,
        departmentName: e.departmentName ?? null,
        hasManager: e.managerStaffId != null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
