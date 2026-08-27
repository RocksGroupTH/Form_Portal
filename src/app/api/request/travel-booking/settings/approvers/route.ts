import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  getBookingApproverIdByStaffId,
  listBookingApprovers,
  setBookingApproverActive,
  upsertBookingApprover,
} from "@/lib/acc/booking-approver-service";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { setBookingApproverTabs } from "@/lib/acc/travel-booking/booking-approver-tabs";
import { filterStorableBookingKeys } from "@/lib/acc/travel-booking/settings-tabs";

/*
 * AP-17's สิทธิ์เข้าถึง tab — the roster that decides who sees the booking
 * queue and the booking report.
 *
 * **Admin only, and deliberately not openable by a grant.** The other four
 * AP-17 settings tabs can now be handed to an individual booking approver
 * (`requireBookingSettingsTab`); this one cannot, and never will be. It is
 * where the grants are handed out, so anyone who could POST here could write
 * themselves in and then grant themselves the rest — which is why `access` is
 * absent from `GRANTABLE_BOOKING_TABS` and why `decideBookingTabAccess` refuses
 * it for a non-admin even if a row for it exists.
 *
 * The path matters. `/api/request/travel-booking` is mapped to AP-17 in
 * `ROUTE_RULES` (`@/lib/form-environment/classify-path`), so the URL prefix is
 * what decides which form database `getAccPool()` opens. `AccBookingApprover`
 * is a shared master table and every write below goes through `writeBothPools`
 * inside the service, so both databases stay in step regardless.
 */

const HR_NOT_FOUND =
  "ไม่พบพนักงานที่ยังทำงานอยู่ในระบบ HR สำหรับอีเมลนี้ — เพิ่มผู้มีสิทธิ์เข้าถึงไม่ได้";
const HR_UNAVAILABLE =
  "ตรวจสอบข้อมูลพนักงานจากระบบ HR ไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง";

/**
 * GET /api/request/travel-booking/settings/approvers
 * Returns the full roster, inactive rows included, for the admin panel — each
 * row carrying its `settingsTabs` grants so the panel can render the ticks.
 * Requires IT Admin or System Admin.
 */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const data = await listBookingApprovers(false);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/travel-booking/settings/approvers] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/request/travel-booking/settings/approvers
 * Body: { email, displayName?, isActive?, settingsTabs? }
 *
 * `StaffId` is the natural key of the table and is resolved **here**, from HR,
 * by email — the client never supplies one. AD search returns an Entra
 * identity, which knows nothing about staff numbers, and a client-supplied id
 * would let a caller point a roster row at somebody else's employee record.
 *
 * `settingsTabs`: **omitted leaves the grants alone**; an array is the whole
 * granted set, so `[]` revokes everything. The distinction is the point — the
 * add-approver call and any future partial save send no tabs, and treating that
 * as an empty set would silently revoke every grant the person held. The field
 * carries both vocabularies stored in `AccBookingApproverTab` — settings-tab
 * keys and the two work-queue menu keys — so it is filtered by
 * `filterStorableBookingKeys`, not the narrower `filterGrantableBookingTabKeys`:
 * that one would strip a menu key before it ever reached
 * `setBookingApproverTabs`, silently discarding half of what the panel posts.
 * Unknown keys are dropped either way — the client's list is a request, not a
 * decision.
 * Requires IT Admin or System Admin.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!email) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุอีเมล" }, { status: 400 });
    }

    // AP-1's approvers route treats this lookup as best-effort and adds the row
    // anyway. AP-17 refuses: a row with no StaffId has no natural key, and the
    // whole point of the roster is to name a person HR still knows about.
    // A lookup that *throws* is a different answer from one that finds nothing
    // — an unreachable HR database must not read as "no such employee".
    let employee;
    try {
      const result = await findActiveEmployeeByEmail(email);
      employee = result.employee;
    } catch (err) {
      console.error("[api/request/travel-booking/settings/approvers] HR lookup failed", err);
      return NextResponse.json({ ok: false, error: HR_UNAVAILABLE }, { status: 503 });
    }
    if (!employee?.staffId) {
      return NextResponse.json({ ok: false, error: HR_NOT_FOUND }, { status: 400 });
    }

    const displayName =
      (typeof body?.displayName === "string" ? body.displayName.trim() : "") ||
      employee.fullName ||
      email;

    await upsertBookingApprover({
      staffId: employee.staffId,
      // The posted address, not HR's: `isBookingApprover` matches this column
      // against the signed-in session's email, which is the Entra one.
      email,
      displayName,
      isActive: typeof body?.isActive === "boolean" ? body.isActive : true,
      // Passed on every call, not only when adding — the service feeds it to
      // `UpdatedBy` on the MERGE's matched branch as well as `CreatedBy` on the
      // insert, so omitting it on an edit would record the wrong person.
      createdBy: Number(session.user.id),
    });

    // `Array.isArray` is what makes "omitted" different from "[]". Without it a
    // save that carries no tabs — adding someone from the AD modal, or any
    // later partial edit — would clear every grant they hold, and
    // `setBookingApproverTabs` replaces rather than merges, in both databases.
    if (Array.isArray(body.settingsTabs)) {
      // Resolved from the StaffId this route derived from HR, never from a
      // posted id: the grants hang off `AccBookingApprover.Id`, and letting the
      // client name that row would let one caller rewrite another's grants.
      // The upsert above has just run, so the row exists.
      const approverId = await getBookingApproverIdByStaffId(employee.staffId);
      if (approverId) {
        await setBookingApproverTabs(
          approverId,
          filterStorableBookingKeys(
            (body.settingsTabs as unknown[]).map((k) => String(k)),
          ),
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/travel-booking/settings/approvers] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/request/travel-booking/settings/approvers
 * Body: { staffId, isActive }
 * Soft delete / restore — the row stays so history keeps reading.
 *
 * It sends no `settingsTabs` and must not: `resolveBookingTabsByEmail` tests
 * `IsActive = 1`, so deactivating already revokes every tab without deleting a
 * grant row, and restoring brings back exactly what the person had.
 * Requires IT Admin or System Admin.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const staffId = Number(body?.staffId);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return NextResponse.json({ ok: false, error: "staffId required" }, { status: 400 });
    }
    if (typeof body?.isActive !== "boolean") {
      return NextResponse.json({ ok: false, error: "isActive required" }, { status: 400 });
    }

    await setBookingApproverActive(staffId, body.isActive, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/travel-booking/settings/approvers] PATCH", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
