import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/**
 * The brands AP-17's booking form may be filed under — AP-1's twin, keyed on a
 * different form code, because `AccFormBrand` holds a row per (form, brand) and
 * granting one form a brand must not grant it to the other.
 *
 * Empty until an admin ticks something at Settings → ตั้งค่าแบบฟอร์มขอเดินทาง →
 * แบรนด์ที่เบิก; nothing is seeded. The form renders that as its own state
 * rather than as an empty picker.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await getAllowedBrands(AP17_FORM_CODE);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
