import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  listReasons,
  listAccommodations,
  listVehicles,
  listRentVehicles,
} from "@/lib/acc/travel-booking/settings-service";

/**
 * GET /api/request/travel-booking/options/settings — the 4 active settings lists
 * (reasons/accommodations/vehicles/rentVehicles) in one payload, for the AP-17 form.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const [reasons, accommodations, vehicles, rentVehicles] = await Promise.all([
      listReasons(true),
      listAccommodations(true),
      listVehicles(true),
      listRentVehicles(true),
    ]);
    return NextResponse.json({
      ok: true,
      data: { reasons, accommodations, vehicles, rentVehicles },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
