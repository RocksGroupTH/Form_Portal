import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { testGoogleMapsKey, GoogleMapsReferrerRestrictedError } from "@/lib/google-maps";
import { invalidateGoogleReadyCache } from "@/lib/map-provider";

/** POST — verify Google Maps key; invalidates readiness cache on success. */
export async function POST() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const count = await testGoogleMapsKey();
    invalidateGoogleReadyCache();
    return NextResponse.json({ ok: true, data: { count, mode: "server" } });
  } catch (e) {
    if (e instanceof GoogleMapsReferrerRestrictedError) {
      invalidateGoogleReadyCache();
      return NextResponse.json({
        ok: true,
        data: { count: 0, mode: "referrer-restricted", message: e.message },
      });
    }
    const message = e instanceof Error ? e.message : "ทดสอบไม่สำเร็จ";
    const hint =
      message.includes("REQUEST_DENIED")
        ? " — ถ้าจำกัด HTTP referrer ให้กดทดสอบจากหน้านี้ (เบราว์เซอร์) แทน หรือตรวจ Billing / เปิด Geocoding API"
        : "";
    return NextResponse.json(
      { ok: false, error: `${message}${hint}` },
      { status: 400 },
    );
  }
}
