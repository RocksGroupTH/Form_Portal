import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  UatPerDiemInputError,
  listAllUatPerDiemRates,
  setUatPerDiemRateActive,
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

/** The soft delete. A rate a UAT trip was already priced at is history. */
export async function PATCH(req: NextRequest) {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { id?: number; isActive?: boolean };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0 || typeof body.isActive !== "boolean") {
      return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
    }
    await setUatPerDiemRateActive(id, body.isActive, Number(session.user.id) || null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/settings/uat-users/per-diem] PATCH", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
