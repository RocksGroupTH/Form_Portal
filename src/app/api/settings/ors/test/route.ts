import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { orsGeocode } from "@/lib/ors";

/** POST — verify the configured ORS key works by running a sample geocode. */
export async function POST() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const results = await orsGeocode("กรุงเทพ");
    return NextResponse.json({ ok: true, data: { count: results.length } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ทดสอบไม่สำเร็จ" },
      { status: 400 },
    );
  }
}
