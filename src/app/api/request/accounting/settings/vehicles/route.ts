import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { listVehicles, upsertVehicle } from "@/lib/acc/settings-service";

/**
 * GET /api/request/accounting/settings/vehicles
 * Returns the full list of vehicles (including inactive).
 * Requires an admin, or the `vehicles` settings-tab grant.
 */
export async function GET() {
  const session = await requireSettingsTab("vehicles");
  if (session instanceof Response) return session;

  try {
    const data = await listVehicles(false);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/vehicles] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/request/accounting/settings/vehicles
 * Upserts a vehicle record.
 * Body: { id?, name, ratePerKm?, isManualEntry, isActive?, sortOrder? }
 * Requires an admin, or the `vehicles` settings-tab grant.
 * Returns 400 if validation fails (e.g. ratePerKm < 1 and not manual).
 */
export async function POST(req: NextRequest) {
  const session = await requireSettingsTab("vehicles");
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    await upsertVehicle(body, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error("[api/request/accounting/settings/vehicles] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
