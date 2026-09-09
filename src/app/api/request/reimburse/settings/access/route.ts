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
import { filterStorableReimburseKeys } from "@/lib/acc/reimburse/settings-tabs";
import {
  listReimburseApproverBrands,
  listReimburseApprovers,
  setReimburseApproverBrands,
} from "@/lib/acc/reimburse/settings-service";
import { normalizeScopeTargets } from "@/lib/acc/reimburse/brand-scope";

/*
 * AP-4's สิทธิ์เข้าถึง tab — who may open which of AP-4's back-office settings,
 * and, since 2026-09-10, who approves real payments.
 *
 * **This roster is not the approval pool, even though this screen now shows
 * both.** `AccReimburseApprover` decides who takes the ACCOUNT and
 * ACCOUNT_FINAL steps on real reimbursement payments; `AccReimburseAccess`
 * decides who may edit the payment-rule checklist and the brand allowlist.
 * Keeping the two TABLES apart is the whole reason migration 120 adds a second
 * one rather than reusing the first, and that still holds — what merged is the
 * SCREEN, not the storage. The former `settings/approvers` route is gone; its
 * job (adding/reactivating an `AccReimburseApprover` row) is now a side effect
 * of ticking a brand here, through `setReimburseApproverBrands`, which derives
 * `IsActive` from the tick count rather than taking it as a separate flag (see
 * that function's own docblock — there is deliberately no toggle to
 * contradict the ticks).
 *
 * **Admin only, and deliberately not openable by a grant.** The other AP-4
 * settings tabs can now be handed to an individual
 * (`requireReimburseSettingsTab`); this one cannot, and never will be. It is
 * where the grants are handed out — including, now, the brand ticks that make
 * somebody an approver — so anyone who could POST here could write themselves
 * in and then grant themselves the rest, which is why `access` is absent from
 * `GRANTABLE_REIMBURSE_TABS` and why `decideReimburseTabAccess` refuses it for
 * a non-admin even if a row for them exists.
 *
 * The path matters. `/api/request/reimburse` is mapped to AP-4 in `ROUTE_RULES`
 * (`@/lib/form-environment/classify-path`), so the URL prefix is what decides
 * which form database `getAccPool()` opens. Every table here is a shared
 * master table and every write below goes through `writeBothPools` inside the
 * service, so the two databases stay in step regardless.
 */

const HR_NOT_FOUND =
  "ไม่พบพนักงานที่ยังทำงานอยู่ในระบบ HR สำหรับอีเมลนี้ — เพิ่มผู้มีสิทธิ์เข้าถึงไม่ได้";
const HR_UNAVAILABLE =
  "ตรวจสอบข้อมูลพนักงานจากระบบ HR ไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง";

/**
 * GET /api/request/reimburse/settings/access
 * The full roster, inactive rows included, for the admin panel — each row
 * carrying its `settingsTabs` grants AND its `brandTargets`, so the merged
 * grid can render both tick groups off one row.
 *
 * `AccReimburseAccess` stays the base list: every row on screen is one of its
 * rows, in its order. `brandTargets` is joined on afterward, from a different
 * table on a different surrogate key — `listReimburseApproverBrands()` is
 * keyed by `AccReimburseApprover.Id`, not by `AccReimburseAccess.Id` (this
 * row's own `id`), so the join goes through `StaffId`, the one column the two
 * rosters agree on: resolve this row's `AccReimburseApprover.Id` from
 * `listReimburseApprovers()` first, THEN look that id up in the brand map.
 * A person with no `AccReimburseApprover` row yet (never ticked a brand)
 * simply reads `[]` — not an error, and not "unrestricted"; see
 * `brand-scope.ts` for why AP-4 has no state where absence means "all".
 * Requires IT Admin or System Admin.
 */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const [accessRows, approverRows, brandMap] = await Promise.all([
      listReimburseAccess(false),
      listReimburseApprovers(),
      listReimburseApproverBrands(),
    ]);
    const approverIdByStaffId = new Map(approverRows.map((a) => [a.staffId, a.id]));
    const data = accessRows.map((row) => {
      const approverId = approverIdByStaffId.get(row.staffId);
      return {
        ...row,
        brandTargets: approverId != null ? (brandMap.get(approverId) ?? []) : [],
      };
    });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reimburse/settings/access] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/request/reimburse/settings/access
 * Body: { email, displayName?, isActive?, settingsTabs?, brandTargets? }
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
 * **The name predates the second, menu-key vocabulary** (`approvalQueue`,
 * `clearance`) that AP-4's accounting queue added on top of the settings-tab
 * one — it is kept as-is because the client already sends this field name,
 * and this array now legitimately carries both kinds of key at once. The
 * pre-filter here is deliberately the WIDE one, `filterStorableReimburseKeys`
 * — narrowing it to `filterGrantableReimburseTabKeys` would strip a menu key
 * before `setReimburseAccessTabs`'s own (also wide) filter ever saw it, so a
 * ticked menu would save nothing. Unknown keys — `access` above all, and
 * anything that is neither a grantable tab nor a real menu key — are still
 * dropped before the write either way: the client's list is a request, not a
 * decision.
 *
 * `brandTargets`: the same "omitted leaves it alone, an array is the whole
 * set" rule as `settingsTabs` — and independently so, since the two write
 * different tables. The Add flow posts neither, so a brand-new row gets no
 * settings-tab grant and is not an approver of anything until an admin ticks
 * something. `normalizeScopeTargets` is applied here, explicitly, before the
 * array reaches `setReimburseApproverBrands` — which normalizes again
 * internally — mirroring the two-filter shape `settingsTabs` already has with
 * `filterStorableReimburseKeys` on both sides of the same call. Neither filter
 * widens the other's vocabulary: this one only ever narrows to the four
 * known interface-brand codes, never to a settings-tab or menu key.
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
        // Wide filter, deliberately: `settingsTabs` on the wire now carries
        // menu keys too (see the docblock above), and `setReimburseAccessTabs`
        // applies this same wide filter again on its own. A narrow pre-filter
        // here would strip a menu key before the wide one downstream ever saw
        // it, which is exactly how AP-17's equivalent tick once saved nothing.
        await setReimburseAccessTabs(
          accessId,
          filterStorableReimburseKeys((body.settingsTabs as unknown[]).map((k) => String(k))),
        );
      }
    }

    // A different table, keyed off the same StaffId this route already
    // resolved from HR — never off `accessId` above, which names an
    // `AccReimburseAccess` row and has nothing to do with
    // `AccReimburseApprover`. `setReimburseApproverBrands` derives
    // `AccReimburseApprover.IsActive` from the tick count itself (see its own
    // docblock), so there is no separate active flag to post here.
    if (Array.isArray(body.brandTargets)) {
      const targets = normalizeScopeTargets(body.brandTargets as unknown[]);
      await setReimburseApproverBrands(employee.staffId, targets, Number(session.user.id), {
        // The HR address, preferred in the same order the deleted
        // `settings/approvers` route preferred it: `AccReimburseApprover.Email`
        // is `findActiveApprover`'s only fallback for an approver with no HR
        // row, and the second arm of `/my-work`'s AP-4 clause — the posted
        // address is only the fallback when HR has none. `AccReimburseAccess`
        // deliberately keeps the posted address instead (see `upsertReimburseAccess`
        // above); the two rosters are allowed to disagree about which email is
        // authoritative because they answer different questions.
        email: employee.email ?? employee.emailCompBr ?? email,
        displayName,
      });
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
