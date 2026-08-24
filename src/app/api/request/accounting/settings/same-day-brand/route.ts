import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import {
  listSameDayBrandStaff,
  upsertSameDayBrandStaff,
  removeSameDayBrandStaff,
} from "@/lib/acc/settings-service";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";

/**
 * GET /api/request/accounting/settings/same-day-brand
 * Lists staff allowed to claim the same travel date across different brands.
 * Requires an admin, or the `sameDayBrand` settings-tab grant.
 */
export async function GET() {
  const session = await requireSettingsTab("sameDayBrand");
  if (session instanceof Response) return session;
  try {
    const data = await listSameDayBrandStaff();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/same-day-brand] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST — upsert an allowlist entry.
 * Body: { id?, staffId?, email?, displayName?, isActive? }
 * When adding via AD search only email is known; resolve StaffId from HR.
 */
export async function POST(req: NextRequest) {
  const session = await requireSettingsTab("sameDayBrand");
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    if (!body.staffId && body.email) {
      try {
        const { employee } = await findActiveEmployeeByEmail(body.email);
        if (employee?.staffId) {
          body.staffId = employee.staffId;
          if (!body.displayName && employee.fullName) body.displayName = employee.fullName;
        }
      } catch {
        /* HR lookup best-effort */
      }
    }
    if (!body.id && !body.staffId) {
      return NextResponse.json(
        { ok: false, error: "ไม่พบรหัสพนักงาน (StaffId) ของผู้ใช้นี้ในระบบ HR" },
        { status: 400 },
      );
    }
    await upsertSameDayBrandStaff(body, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/accounting/settings/same-day-brand] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE ?id= — remove an allowlist entry. */
export async function DELETE(req: NextRequest) {
  const session = await requireSettingsTab("sameDayBrand");
  if (session instanceof Response) return session;
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    await removeSameDayBrandStaff(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/accounting/settings/same-day-brand] DELETE", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
