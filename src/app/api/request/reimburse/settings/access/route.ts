import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  getReimburseAccessIdByStaffId,
  listReimburseAccess,
  setReimburseAccessActive,
  upsertReimburseAccess,
} from "@/lib/acc/reimburse/access-service";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { setReimburseAccessTabs } from "@/lib/acc/reimburse/access-tabs";
import { filterGrantableReimburseTabKeys } from "@/lib/acc/reimburse/settings-tabs";

/*
 * AP-4's สิทธิ์เข้าถึง tab — who may open which of AP-4's back-office settings.
 *
 * **This roster is not the approval pool.** `AccReimburseApprover`
 * (`settings/approvers`) decides who takes the ACCOUNT and ACCOUNT_FINAL steps
 * on real reimbursement payments; `AccReimburseAccess` decides who may edit the
 * payment-rule checklist and the brand allowlist. Keeping them apart is the
 * whole reason migration 106 adds a second table rather than reusing the first.
 *
 * **Admin only, and deliberately not openable by a grant.** The other AP-4
 * settings tabs can now be handed to an individual
 * (`requireReimburseSettingsTab`); this one cannot, and never will be. It is
 * where the grants are handed out, so anyone who could POST here could write
 * themselves in and then grant themselves the rest — which is why `access` is
 * absent from `GRANTABLE_REIMBURSE_TABS`, along with `approvers`, and why
 * `decideReimburseTabAccess` refuses both for a non-admin even if a row for
 * them exists.
 *
 * The path matters. `/api/request/reimburse` is mapped to AP-4 in `ROUTE_RULES`
 * (`@/lib/form-environment/classify-path`), so the URL prefix is what decides
 * which form database `getAccPool()` opens. Both tables are shared master
 * tables and every write below goes through `writeBothPools` inside the
 * service, so the two databases stay in step regardless.
 */

const HR_NOT_FOUND =
  "ไม่พบพนักงานที่ยังทำงานอยู่ในระบบ HR สำหรับอีเมลนี้ — เพิ่มผู้มีสิทธิ์เข้าถึงไม่ได้";
const HR_UNAVAILABLE =
  "ตรวจสอบข้อมูลพนักงานจากระบบ HR ไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง";

/**
 * GET /api/request/reimburse/settings/access
 * The full roster, inactive rows included, for the admin panel — each row
 * carrying its `settingsTabs` grants so the panel can render the ticks.
 * Requires IT Admin or System Admin.
 */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const data = await listReimburseAccess(false);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reimburse/settings/access] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/request/reimburse/settings/access
 * Body: { email, displayName?, isActive?, settingsTabs? }
 *
 * `StaffId` is the natural key of the table and is resolved **here**, from HR,
 * by email — the client never supplies one. AD search returns an Entra
 * identity, which knows nothing about staff numbers, and a client-supplied id
 * would let a caller point a roster row at somebody else's employee record.
 *
 * `settingsTabs`: **omitted leaves the grants alone**; an array is the whole
 * granted set, so an empty array revokes everything. The distinction is the
 * point — the add call and any future partial save send no tabs, and treating
 * that as an empty set would silently revoke every grant the person held.
 * Unknown keys — `access` and `approvers` above all — are dropped by
 * `filterGrantableReimburseTabKeys` before the write: the client's list is a
 * request, not a decision.
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

    // Refused rather than added without one, as AP-17 does: a row with no
    // StaffId has no natural key, and the point of the roster is to name a
    // person HR still knows about. A lookup that *throws* is a different answer
    // from one that finds nothing — an unreachable HR database must not read as
    // "no such employee".
    let employee;
    try {
      const result = await findActiveEmployeeByEmail(email);
      employee = result.employee;
    } catch (err) {
      console.error("[api/request/reimburse/settings/access] HR lookup failed", err);
      return NextResponse.json({ ok: false, error: HR_UNAVAILABLE }, { status: 503 });
    }
    if (!employee?.staffId) {
      return NextResponse.json({ ok: false, error: HR_NOT_FOUND }, { status: 400 });
    }

    const displayName =
      (typeof body?.displayName === "string" ? body.displayName.trim() : "") ||
      employee.fullName ||
      email;

    await upsertReimburseAccess({
      staffId: employee.staffId,
      // The posted address, not HR's: `resolveReimburseTabsByEmail` matches this
      // column against the signed-in session's email, which is the Entra one.
      email,
      displayName,
      isActive: typeof body?.isActive === "boolean" ? body.isActive : true,
      // Passed on every call, not only when adding — the service feeds it to
      // `UpdatedBy` on the MERGE's matched branch as well as `CreatedBy` on the
      // insert, so omitting it on an edit would record the wrong person.
      createdBy: Number(session.user.id),
    });

    // `Array.isArray` is what makes omitted different from empty. Without it a
    // save carrying no tabs — adding someone from the AD modal, or any later
    // partial edit — would clear every grant they hold, and
    // `setReimburseAccessTabs` replaces rather than merges, in both databases.
    if (Array.isArray(body.settingsTabs)) {
      // Resolved from the StaffId this route derived from HR, never from a
      // posted id: the grants hang off `AccReimburseAccess.Id`, and letting the
      // client name that row would let one caller rewrite somebody else's
      // grants. The upsert above has just run, so the row exists.
      const accessId = await getReimburseAccessIdByStaffId(employee.staffId);
      if (accessId) {
        await setReimburseAccessTabs(
          accessId,
          filterGrantableReimburseTabKeys(
            (body.settingsTabs as unknown[]).map((k) => String(k)),
          ),
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reimburse/settings/access] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/request/reimburse/settings/access
 * Body: { staffId, isActive }
 * Soft delete / restore — the row stays so history keeps reading.
 *
 * It sends no `settingsTabs` and must not: `resolveReimburseTabsByEmail` tests
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

    await setReimburseAccessActive(staffId, body.isActive, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reimburse/settings/access] PATCH", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
