import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  getAdvClrAccessIdByStaffId,
  listAdvClrAccess,
  setAdvClrAccessActive,
  setAdvClrAccessTabs,
  upsertAdvClrAccess,
} from "@/lib/adv/access-service";
import { ADV_CLR_FORMS, filterStorableAdvClrKeys, type AdvClrForm } from "@/lib/adv/settings-tabs";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";

/*
 * AP-2 and AP-3's สิทธิ์เข้าถึง tab — who may open which of their back-office
 * settings, and which of their working menus.
 *
 * **One route for two forms, because there is one roster.** `AccAdvClrAccess`
 * carries no `FormCode` (migration 152, the user's decision on 2026-09-14), so
 * AP-3's settings page calls this same path. That is deliberate rather than a
 * shortcut, and it is safe for the reason the `bu-gl-map` pair is NOT: these
 * are shared master tables written through `writeBothPools`, so the rows are
 * identical in both form databases and it cannot matter which one a given
 * request resolves. `"/api/request/advance/settings" → null` in `ROUTE_RULES`
 * pins this path to Production; the write still lands in both.
 *
 * **This roster is not either approval pool.** `AccAdvanceApprover` and
 * `AccClearAdvanceApprover` decide who takes real approval steps on real
 * money; this table decides who may SEE a settings tab or a working screen.
 * Keeping the tables apart is the whole reason 152 adds a new one rather than
 * hanging grants off an approver roster — see that migration's header.
 *
 * **Admin only, and deliberately not openable by a grant.** The other tabs can
 * now be handed to an individual (`requireAdvClrSettingsTab`); this one cannot,
 * and never will be. It is where the grants are handed out, so anyone who could
 * POST here could write themselves in and then grant themselves the rest —
 * which is why `access` is absent from `GRANTABLE_ADV_CLR_TABS` and why
 * `decideAdvClrTabAccess` refuses it for a non-admin even if a row exists.
 */

const HR_NOT_FOUND =
  "ไม่พบพนักงานที่ยังทำงานอยู่ในระบบ HR สำหรับอีเมลนี้ — เพิ่มผู้มีสิทธิ์เข้าถึงไม่ได้";
const HR_UNAVAILABLE =
  "ตรวจสอบข้อมูลพนักงานจากระบบ HR ไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง";
const FORM_REQUIRED =
  "ไม่ทราบว่ากำลังบันทึกสิทธิ์ของฟอร์มใด — กรุณารีเฟรชหน้านี้แล้วลองใหม่";

/**
 * Which form's grants this POST is replacing.
 *
 * **Absent or unrecognised is refused, never defaulted.** The write replaces
 * exactly the named form's keys, so guessing would hand one form's screen the
 * power to clear the other's — the failure this whole split exists to close. A
 * browser left open on the previous bundle posts no `form` and gets a 400 with
 * copy telling the admin to reload: a visible refusal, rather than a silent
 * deletion of grants nobody will notice until somebody loses a menu.
 */
function readForm(raw: unknown): AdvClrForm | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  for (const f of ADV_CLR_FORMS) if (f === v) return f;
  return null;
}

/**
 * GET — the full roster, **inactive rows included**, for the admin grid.
 *
 * Inactive rows stay listed on purpose, the same choice AP-4's grid makes:
 * hiding them leaves an admin unable to see what a deactivated person still
 * holds, and a grid that drops a row the moment its own button is pressed is a
 * dead end — deactivating is exactly what an active-only filter removes.
 */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listAdvClrAccess(false) });
  } catch (err) {
    console.error("[api/request/advance/settings/access] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST — add or update one person.
 * Body: `{ email, displayName?, isActive?, settingsTabs?, form? }`
 *
 * `StaffId` is the natural key and is resolved **here**, from HR, by email —
 * the client never supplies one. AD search returns an Entra identity, which
 * knows nothing about staff numbers, and a client-supplied id would let a
 * caller point a roster row at somebody else's employee record. A lookup that
 * *throws* is a different answer from one that finds nothing: an unreachable HR
 * database must not read as "no such employee".
 *
 * `settingsTabs`: **omitted leaves the grants alone**; an array is the whole
 * granted set **of the named form**, so an empty array revokes that form's
 * grants and leaves the other form's untouched. The distinction is the
 * point — the Add call sends no tabs, and treating that as an empty set would
 * silently revoke every grant the person held, in both databases, since
 * `setAdvClrAccessTabs` replaces rather than merges. The field's name predates
 * the menu vocabulary it now also carries, and the pre-filter here is
 * deliberately the WIDE one: narrowing it to the grantable tabs alone would
 * strip a menu key before the (also wide) filter downstream ever saw it, which
 * is exactly how AP-17's equivalent tick once saved nothing. Narrowing it to
 * one *form* here would be just as wrong for the opposite reason — that is
 * `setAdvClrAccessTabs`' own job, done against the same partition its bounded
 * `DELETE` uses, so the two can never disagree about what the save owns.
 *
 * `form`: **required whenever `settingsTabs` is present**, because that is the
 * half of the roster being replaced. See `readForm`.
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

    // Validated BEFORE the upsert, not beside the write it guards: a 400 raised
    // after `upsertAdvClrAccess` has run would have already created the roster
    // row, or rewritten a name, for a request this route is about to refuse.
    const savingTabs = Array.isArray(body?.settingsTabs);
    const form = savingTabs ? readForm(body?.form) : null;
    if (savingTabs && !form) {
      return NextResponse.json({ ok: false, error: FORM_REQUIRED }, { status: 400 });
    }

    let employee;
    try {
      employee = (await findActiveEmployeeByEmail(email)).employee;
    } catch (err) {
      console.error("[api/request/advance/settings/access] HR lookup failed", err);
      return NextResponse.json({ ok: false, error: HR_UNAVAILABLE }, { status: 503 });
    }
    if (!employee?.staffId) {
      return NextResponse.json({ ok: false, error: HR_NOT_FOUND }, { status: 400 });
    }

    const displayName =
      (typeof body?.displayName === "string" ? body.displayName.trim() : "") ||
      employee.fullName ||
      email;

    await upsertAdvClrAccess({
      staffId: employee.staffId,
      // The posted address, not HR's: `resolveAdvClrTabsByEmail` matches this
      // column against the signed-in session's email, which is the Entra one.
      email,
      displayName,
      isActive: typeof body?.isActive === "boolean" ? body.isActive : undefined,
      createdBy: Number(session.user.id),
    });

    // `savingTabs` is `Array.isArray`, which is what makes omitted different
    // from empty; `form` is non-null exactly when it is true.
    if (savingTabs && form) {
      // Resolved from the StaffId this route derived from HR, never from a
      // posted id: letting the client name the row would let one caller rewrite
      // somebody else's grants. The upsert above has just run, so it exists.
      const accessId = await getAdvClrAccessIdByStaffId(employee.staffId);
      if (accessId) {
        await setAdvClrAccessTabs(
          accessId,
          filterStorableAdvClrKeys((body.settingsTabs as unknown[]).map((k) => String(k))),
          form,
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/access] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH — the on/off switch. Body: `{ staffId, isActive }`.
 *
 * A soft delete: grant rows are untouched, so the grid keeps showing what a
 * deactivated person holds and switching them back on restores exactly that
 * rather than a blank slate. Neither approver roster is touched — those have
 * their own controls on this same tab, and switching สิทธิ์เข้าถึง off must not
 * silently retire somebody from an approval step nobody asked it to.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const staffId = Number(body?.staffId);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return NextResponse.json({ ok: false, error: "staffId ไม่ถูกต้อง" }, { status: 400 });
    }
    if (typeof body?.isActive !== "boolean") {
      return NextResponse.json({ ok: false, error: "isActive ไม่ถูกต้อง" }, { status: 400 });
    }
    await setAdvClrAccessActive(staffId, body.isActive, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/access] PATCH", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
