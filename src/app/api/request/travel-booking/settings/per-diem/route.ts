import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  PerDiemRateError,
  listAllPerDiemCountryRates,
  setPerDiemCountryRateActive,
  upsertPerDiemCountryRate,
} from "@/lib/acc/travel-booking/perdiem-source";

/**
 * AP-17's per-diem rate per country — admin only, on every method.
 *
 * **Not `requireBookingSettingsTab`, and `per-diem` is deliberately not a
 * grantable tab key.** A row here changes what the company pays a travelling
 * employee per day, on a path that writes `AccRequest.TotalAmount`. That is a
 * different kind of power from "may see the booking queue", which is what
 * AP-17's tab grants hand out, and the two must not be the same tick.
 *
 * `settings-tabs.test.ts` asserts which routes are allowed to stay on
 * `requireRole`, so adding a third has to be a deliberate act with its reason
 * written beside it.
 */

const ADMIN = ["IT Admin", "System Admin"] as const;

export async function GET() {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listAllPerDiemCountryRates() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as {
      countryCode?: string;
      effectiveDate?: string;
      amount?: number | string;
      note?: string | null;
    };
    await upsertPerDiemCountryRate(
      {
        countryCode: (body.countryCode ?? "").trim(),
        effectiveDate: (body.effectiveDate ?? "").trim(),
        amount: Number(body.amount),
        note: body.note ?? null,
      },
      Number(session.user.id) || null,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    // The service's own refusals are in Thai and name the problem; a constraint
    // violation surfacing raw would say "CK_AccTravelPerDiemCountry_Amount".
    if (e instanceof PerDiemRateError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}

/** The soft delete. A rate a trip was already priced at is history, not a mistake. */
export async function PATCH(req: NextRequest) {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { id?: number; isActive?: boolean };
    if (!body.id || typeof body.isActive !== "boolean") {
      return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
    }
    await setPerDiemCountryRateActive(body.id, body.isActive, Number(session.user.id) || null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}
