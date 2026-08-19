import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listReimburseApprovers,
  setReimburseApproverActive,
  upsertReimburseApprover,
} from "@/lib/acc/reimburse/settings-service";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";

/**
 * AP-4's accounting approver pool (`AccReimburseApprover`) — the roster both
 * accounting steps answer to.
 *
 * Its own table rather than AP-1's `AccApprover` (spec decision 3), so this is
 * its own endpoint too: editing one form's approvers must not silently change
 * the other's.
 *
 * Admin-only in both directions. Unlike the rules checklist there is no
 * requester-facing read — the form never needs to know who will approve it, and
 * publishing the roster to everyone would be a list of who can authorise a
 * payment.
 */

/** Matches AP-1's settings routes, which are the neighbouring precedent. */
const SETTINGS_ROLES = ["IT Admin", "System Admin"] as const;

/**
 * `StaffId` is `NOT NULL UNIQUE` and it is the identity the two-person rule
 * compares (`canActFinalStep`), so an approver who cannot be resolved to an HR
 * `Employee` cannot be stored at all. AP-1's equivalent treats the HR lookup as
 * best-effort because its own column is nullable; here a failure has to be a
 * refusal, and it has to say what to do about it.
 */
const NO_HR_EMPLOYEE =
  "ไม่พบพนักงานที่ใช้งานอยู่ในระบบ HR สำหรับอีเมลนี้ — ผู้อนุมัติต้องมี StaffId จึงจะเพิ่มได้";

const EMAIL_REQUIRED = "กรุณาเลือกผู้ใช้ที่ต้องการเพิ่ม";
const BAD_ACTION = "คำสั่งไม่ถูกต้อง";
const BAD_STAFF_ID = "ไม่พบผู้อนุมัติที่ต้องการแก้ไข";

/* ─────────────────────────── read ─────────────────────────── */

/** GET — the whole roster, active and inactive, so the page can offer "turn back on". */
export async function GET() {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;

  try {
    const data = await listReimburseApprovers();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reimburse/settings/approvers] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/* ─────────────────────────── write ─────────────────────────── */

interface ApproverWriteBody {
  action?: unknown;
  email?: unknown;
  displayName?: unknown;
  staffId?: unknown;
  isActive?: unknown;
}

/**
 * POST — add (or reactivate) an approver, or turn one off.
 *
 * Adding takes an **email**, which is what the AD search modal hands back;
 * `StaffId` and the display name are resolved here from `Rocks_Portal_HR`
 * rather than trusted from the client, because they are what the approval
 * engine matches on and the browser is not the authority on either.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;

  let body: ApproverWriteBody;
  try {
    body = (await req.json()) as ApproverWriteBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const userId = Number(session.user.id);

  try {
    switch (body.action) {
      case "add": {
        const email = typeof body.email === "string" ? body.email.trim() : "";
        if (!email) {
          return NextResponse.json({ ok: false, error: EMAIL_REQUIRED }, { status: 400 });
        }

        // A thrown HR lookup is a 500, not "no such employee": saying the person
        // is not in HR when HR could not be reached sends an admin off to fix a
        // roster that is already correct.
        const { employee } = await findActiveEmployeeByEmail(email);
        if (!employee?.staffId) {
          return NextResponse.json({ ok: false, error: NO_HR_EMPLOYEE }, { status: 400 });
        }

        const displayName =
          (typeof body.displayName === "string" ? body.displayName.trim() : "") ||
          employee.fullName ||
          email;

        await upsertReimburseApprover(
          {
            staffId: employee.staffId,
            // The HR address is the one every other AP-4 lookup uses; the AD
            // address is the fallback when HR has none.
            email: employee.email ?? employee.emailCompBr ?? email,
            displayName,
          },
          userId,
        );
        return NextResponse.json({ ok: true });
      }

      case "setActive": {
        const staffId = Number(body.staffId);
        if (!Number.isInteger(staffId) || staffId <= 0) {
          return NextResponse.json({ ok: false, error: BAD_STAFF_ID }, { status: 400 });
        }
        await setReimburseApproverActive(staffId, body.isActive === true, userId);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: false, error: BAD_ACTION }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/request/reimburse/settings/approvers] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
