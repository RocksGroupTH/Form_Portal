import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listProvinces } from "@/lib/acc/travel-booking/province-service";

/** GET /api/request/travel-booking/options/provinces — active จังหวัด/เมือง, Thai and foreign (Rocks_Portal_Form.dbo.TravelProvince; moved there by 104/105, given a country by 132) */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data = await listProvinces();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
