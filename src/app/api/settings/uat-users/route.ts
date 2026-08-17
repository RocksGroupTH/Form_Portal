import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listUatTesters,
  upsertUatTester,
  setUatTesterActive,
  type UatTesterRow,
} from "@/lib/uat-tester/service";
import {
  findActiveEmployeeByEmail,
  findActiveEmployeeByStaffId,
} from "@/lib/hr/employee-lookup";
import { getAppPool } from "@/lib/db/mssql";
import { env } from "@/env";

/** Case- and whitespace-insensitive email key, matching UatTester's own lookup rules. */
function emailKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Every active AccApprover's email, read from the production form database
 * explicitly — `getAppPool(env.MSSQL_FORM_DATABASE)`, not `getFormPool()`.
 * AccApprover is dual-written and identical in both databases (see
 * CLAUDE.md's 3-database table), so this check must mean "is any real
 * account approver a tester", independent of which environment the calling
 * admin's own session happens to resolve to.
 */
async function loadActiveApproverEmails(): Promise<string[]> {
  const pool = await getAppPool(env.MSSQL_FORM_DATABASE);
  const r = await pool
    .request()
    .query<{ Email: string }>(`SELECT Email FROM [dbo].[AccApprover] WHERE IsActive = 1`);
  return r.recordset.map((row) => row.Email);
}

/** HR's Thai name, falling back to the English name, then the stored email. */
function displayName(
  row: UatTesterRow,
  employee: { fullName: string; fullNameTh: string | null } | null,
): string {
  return employee?.fullNameTh || employee?.fullName || row.email;
}

/**
 * GET — every tester plus two derived facts the page needs: each row's
 * `managerIsTester` (is the configured UAT manager themselves an active
 * tester?) and a top-level `accountApproverIsTester` (does any active
 * AccApprover appear in the active tester list?).
 */
export async function GET() {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;
  try {
    const testers = await listUatTesters();
    const activeEmails = new Set(
      testers.filter((t) => t.isActive).map((t) => emailKey(t.email)),
    );

    const [employees, approverEmails] = await Promise.all([
      Promise.all(testers.map((t) => findActiveEmployeeByStaffId(t.staffId))),
      loadActiveApproverEmails(),
    ]);

    const accountApproverIsTester = approverEmails.some((email) =>
      activeEmails.has(emailKey(email)),
    );

    const data = testers.map((t, i) => ({
      id: t.id,
      staffId: t.staffId,
      email: t.email,
      name: displayName(t, employees[i]),
      managerStaffId: t.managerStaffId,
      managerEmail: t.managerEmail,
      managerIsTester: t.managerEmail ? activeEmails.has(emailKey(t.managerEmail)) : false,
      isActive: t.isActive,
      updatedAt: t.updatedAt,
    }));

    return NextResponse.json({ ok: true, data: { testers: data, accountApproverIsTester } });
  } catch (err) {
    console.error("[api/settings/uat-users] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST { action: "upsert" | "setActive" | "remove", ... } — System Admin only.
 *
 * "upsert" never accepts a StaffId from the client: the AD search box the
 * page uses only ever hands back a directory user (email/name/jobTitle/
 * department), never an HR StaffId, and `UatTester.StaffId` is `NOT NULL
 * UNIQUE`. The chosen email is resolved server-side via
 * `findActiveEmployeeByEmail`, and an email with no active HR row is
 * refused. A `managerEmail` is only accepted when it belongs to an
 * already-active tester — otherwise a request's approval chain could point
 * outside the tester group and stall in a queue no tester can see.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  try {
    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "";

    switch (action) {
      case "upsert": {
        const email = typeof body.email === "string" ? body.email.trim() : "";
        if (!email) {
          return NextResponse.json({ ok: false, error: "กรุณาระบุอีเมลผู้ทดสอบ" }, { status: 400 });
        }

        const { employee } = await findActiveEmployeeByEmail(email);
        if (!employee) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "ไม่พบพนักงานที่ยังปฏิบัติงานอยู่ในระบบ HR สำหรับอีเมลนี้ จึงเพิ่มเป็นผู้ทดสอบ UAT ไม่ได้",
            },
            { status: 400 },
          );
        }

        const managerEmailInput =
          typeof body.managerEmail === "string" ? body.managerEmail.trim() : "";
        let managerStaffId: number | null = null;
        let managerEmail: string | null = null;

        if (managerEmailInput) {
          // The manager must already be an active tester (rule enforced here,
          // not just displayed) — compared case- and whitespace-insensitively
          // since the AD search box and the stored value can differ in case.
          const activeTesters = await listUatTesters();
          const match = activeTesters.find(
            (t) => t.isActive && emailKey(t.email) === emailKey(managerEmailInput),
          );
          if (!match) {
            return NextResponse.json(
              { ok: false, error: "ผู้จัดการสำหรับ UAT ต้องอยู่ในรายชื่อ UAT Users ด้วย" },
              { status: 400 },
            );
          }
          managerStaffId = match.staffId;
          managerEmail = match.email;
        }

        await upsertUatTester({
          staffId: employee.staffId,
          email: employee.email ?? employee.emailCompBr ?? email,
          managerStaffId,
          managerEmail,
          updatedBy: userId,
        });
        return NextResponse.json({ ok: true });
      }

      case "setActive": {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id <= 0) {
          return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
        }
        if (typeof body.isActive !== "boolean") {
          return NextResponse.json({ ok: false, error: "Invalid isActive" }, { status: 400 });
        }
        await setUatTesterActive(id, body.isActive, userId);
        return NextResponse.json({ ok: true });
      }

      case "remove": {
        const id = Number(body.id);
        if (!Number.isInteger(id) || id <= 0) {
          return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
        }
        await setUatTesterActive(id, false, userId);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/settings/uat-users] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
