import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  UatPerDiemInputError,
  listAllUatPerDiemRates,
  upsertUatPerDiemRate,
} from "@/lib/uat-tester/per-diem";
import { listUatTesters } from "@/lib/uat-tester/service";

/**
 * A UAT tester's own per-diem rate — System Admin only, on every method.
 *
 * `requireRole(["System Admin"])`, matching the UAT Users page this lives on and
 * NOT the AP-17 per-diem-country route's IT-Admin-and-above. A row here changes
 * what a UAT trip is priced at, and it is edited from a System-Admin page.
 *
 * Validation happens HERE, before Number() reaches the database
 * (`parseUatPerDiemInput`), not only in the component: this page has never had a
 * typed numeric input before, and its only existing numeric check is on ids the
 * server itself issued.
 *
 * **GET and POST only, deliberately.** There was a PATCH that switched one rate
 * off, and the table's `IsActive` column went with it (migration 143): every
 * stored rate now counts and the effective date alone selects, matching HR's
 * `EmployeeAllowanceLog`. A rate is corrected by POSTing the same effective
 * date, which overwrites it. A stale tab's PATCH gets Next's own 405, which is
 * the right answer and needs no code here.
 *
 * The AP-17 country-rate route one folder over
 * (`/api/request/travel-booking/settings/per-diem`) still HAS a PATCH doing
 * exactly what this one did, and must keep it — its table's flag is read by
 * pricing. Two routes, same last path segment, opposite rules.
 */

const ADMIN = ["System Admin"] as const;

export async function GET() {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listAllUatPerDiemRates() });
  } catch (e) {
    console.error("[api/settings/uat-users/per-diem] GET", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as {
      staffId?: unknown;
      effectiveDate?: unknown;
      amount?: unknown;
      note?: unknown;
    };

    // A rate is only meaningful for somebody on the tester list; without this a
    // typo in a StaffId creates a row nothing will ever read.
    const staffId = Number(body.staffId);
    const testers = await listUatTesters();
    if (!testers.some((t) => t.staffId === staffId)) {
      return NextResponse.json({ ok: false, error: "ไม่พบผู้ทดสอบรายนี้" }, { status: 400 });
    }

    await upsertUatPerDiemRate(
      {
        staffId: body.staffId,
        effectiveDate: body.effectiveDate,
        amount: body.amount,
        note: body.note ?? null,
      },
      Number(session.user.id) || null,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    // The parser's refusals are Thai and name the problem; a constraint
    // violation surfacing raw would say "CK_UatTesterPerDiem_Amount".
    if (e instanceof UatPerDiemInputError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    console.error("[api/settings/uat-users/per-diem] POST", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
