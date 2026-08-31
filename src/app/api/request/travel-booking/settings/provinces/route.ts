import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isKnownCountry } from "@/lib/acc/country-currency";
import {
  listAllProvinces,
  setProvinceActive,
  upsertProvince,
} from "@/lib/acc/travel-booking/province-service";

/**
 * AP-17's จังหวัด/เมือง master — admin only, on every method.
 *
 * **Not `requireBookingSettingsTab`, and not grantable.** These rows are shared
 * with the Rocks Fast sibling through `Fast_Data`'s permanent synonym (migration
 * 105), and that application selects them with no country filter — so adding a
 * row here changes what its users see in their own form. A settings-tab grant
 * must not become write access to another application's data, which is the same
 * rule `settings/departments/map` carries for `DepartmentErpMap`.
 *
 * `provinces` is deliberately absent from `GRANTABLE_BOOKING_TABS`, and
 * `settings-tabs.test.ts` asserts this route is one of the `requireRole` ones.
 */

const ADMIN = ["IT Admin", "System Admin"] as const;

export async function GET() {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listAllProvinces() });
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
      id?: number | null;
      nameTh?: string;
      nameEn?: string | null;
      countryCode?: string;
    };
    const nameTh = (body.nameTh ?? "").trim();
    const countryCode = (body.countryCode ?? "").trim().toUpperCase();

    if (!nameTh) {
      return NextResponse.json({ ok: false, error: "กรุณากรอกชื่อภาษาไทย" }, { status: 400 });
    }
    if (nameTh.length > 100) {
      return NextResponse.json(
        { ok: false, error: "ชื่อภาษาไทยยาวเกิน 100 ตัวอักษร" },
        { status: 400 },
      );
    }
    // Checked here rather than trusted: CountryCode is CHAR(2) NOT NULL with no
    // default (migration 132 drops it deliberately), so an unrecognised code
    // would otherwise be stored and then fail to render a flag or a name.
    if (!isKnownCountry(countryCode)) {
      return NextResponse.json(
        { ok: false, error: "กรุณาเลือกประเทศจากรายการ" },
        { status: 400 },
      );
    }

    const result = await upsertProvince({
      id: body.id ?? null,
      nameTh,
      nameEn: body.nameEn ?? null,
      countryCode,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: `มี "${result.conflict}" อยู่แล้ว — ชื่อภาษาไทยห้ามซ้ำ` },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}

/** The soft delete — there is no hard one; every trip ever filed points at these ids. */
export async function PATCH(req: NextRequest) {
  const session = await requireRole([...ADMIN]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { id?: number; isActive?: boolean };
    if (!body.id || typeof body.isActive !== "boolean") {
      return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
    }
    await setProvinceActive(body.id, body.isActive);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}
