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

const MANAGER_NOT_TESTER_ERROR = "ผู้จัดการสำหรับ UAT ต้องอยู่ในรายชื่อ UAT Users ด้วย";

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

/** HR's Thai name, falling back to the English name, then the stored (login) email. */
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
 *
 * `managerIsTester` is judged by StaffId (`activeStaffIds`), not by
 * re-comparing `ManagerEmail` strings: `Email` is only a denormalized copy
 * on each row, and a tester's own `Email` can be rewritten by a later
 * upsert while every dependant's stored `ManagerEmail` stays as it was —
 * StaffId is the column that never goes stale for this purpose.
 * `accountApproverIsTester` legitimately stays email-based: `AccApprover`
 * has no StaffId to join on, and both it and `UatTester.Email` (since the
 * POST fix below) are the same kind of value — the AD/login address.
 */
export async function GET() {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;
  try {
    const testers = await listUatTesters();
    const activeEmails = new Set(
      testers.filter((t) => t.isActive).map((t) => emailKey(t.email)),
    );
    const activeStaffIds = new Set(testers.filter((t) => t.isActive).map((t) => t.staffId));

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
      managerIsTester: t.managerStaffId !== null && activeStaffIds.has(t.managerStaffId),
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
 * `findActiveEmployeeByEmail` purely to (a) confirm the person has an
 * active HR row and (b) read their StaffId — an email with no active HR
 * row is refused. HR is deliberately NOT the source of the stored `Email`:
 * see the comment inside the handler.
 *
 * A `managerEmail` is only accepted when it resolves (via HR, then matched
 * by StaffId — not by string-comparing two differently-sourced emails) to
 * an already-active tester — otherwise a request's approval chain could
 * point outside the tester group and stall in a queue no tester can see.
 * Self-management is refused outright: with one tester in the table, "any
 * active tester" and "myself" are the same value, and letting that through
 * would make the manager approval step a self-approval.
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

        const allTesters = await listUatTesters();
        const existingRow = allTesters.find((t) => t.staffId === employee.staffId);

        // Only touch the manager columns when the caller actually sent the
        // key — an "add tester" call with no `managerEmail` at all must not
        // silently wipe a manager set by an earlier upsert. `""` is the
        // deliberate clear (the page's "ล้าง" button).
        const hasManagerKey = Object.prototype.hasOwnProperty.call(body, "managerEmail");
        let managerStaffId: number | null = existingRow?.managerStaffId ?? null;
        let managerEmail: string | null = existingRow?.managerEmail ?? null;

        if (hasManagerKey) {
          const managerEmailInput =
            typeof body.managerEmail === "string" ? body.managerEmail.trim() : "";
          if (!managerEmailInput) {
            managerStaffId = null;
            managerEmail = null;
          } else {
            const { employee: managerEmployee } = await findActiveEmployeeByEmail(managerEmailInput);
            if (!managerEmployee) {
              return NextResponse.json({ ok: false, error: MANAGER_NOT_TESTER_ERROR }, { status: 400 });
            }
            if (managerEmployee.staffId === employee.staffId) {
              return NextResponse.json(
                { ok: false, error: "ตั้งตัวเองเป็นผู้จัดการสำหรับ UAT ไม่ได้ — เพิ่มผู้ทดสอบอีกคนก่อน" },
                { status: 400 },
              );
            }
            // Matched by StaffId, not by comparing the typed email string
            // against the stored one — the tester's own `Email` can differ
            // in source/casing from what was just typed here.
            const match = allTesters.find(
              (t) => t.isActive && t.staffId === managerEmployee.staffId,
            );
            if (!match) {
              return NextResponse.json({ ok: false, error: MANAGER_NOT_TESTER_ERROR }, { status: 400 });
            }
            managerStaffId = match.staffId;
            managerEmail = match.email;
          }
        }

        // Store the address the proxy will publish at login (`x-user-email`,
        // sourced from the NextAuth token) — the AD-picked `email` this
        // handler was called with — NOT `employee.email`/`employee.emailCompBr`
        // from HR. `findActiveEmployeeByEmail` matches against *either*
        // `Employee.Email` or `EmailCompBr` (see its `matchMethod` return),
        // so HR's own copy of the address can legitimately differ from the
        // one the person actually signs in with. Every runtime consumer of
        // this table — `getActiveUatTester` via `currentViewerEmail()`
        // (`src/lib/form-environment/index.ts`), the UAT-mode cookie route,
        // and `uatManagerFor` — matches the login email, so that is what
        // must be stored here. `/api/users/search` itself already returns
        // `u.mail ?? u.userPrincipalName` for a user with no `mail`, which
        // is the same address a login would resolve to, so the AD-picked
        // value is the correct one whether or not the person has a mailbox.
        // Lower-cased on write, matching the `addUser` convention in
        // `src/app/api/settings/users/route.ts` — matching is
        // case-insensitive everywhere this table is read, so this is purely
        // storage hygiene, not a correctness requirement.
        const loginEmail = email.toLowerCase();

        await upsertUatTester({
          staffId: employee.staffId,
          email: loginEmail,
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
