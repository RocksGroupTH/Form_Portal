import { NextRequest, NextResponse } from "next/server";
import { isSettingsKind, SETTINGS_KIND_ROUTES } from "@/lib/acc/travel-booking/settings-route-map";
import { requireBookingSettingsTab } from "@/lib/acc/travel-booking/require-booking-settings-tab";

/*
 * The `[kind]` segment IS the granted tab key, so the gate below is
 * per-tab rather than per-role: an admin passes everything, a non-admin
 * booking approver passes only the kinds granted to them in
 * `AccBookingApproverTab`.
 *
 * **Narrow before gating.** `isSettingsKind` is what turns an arbitrary path
 * segment into one of the four known kinds — it uses
 * `Object.prototype.hasOwnProperty.call`, so `__proto__` is refused — and
 * `requireBookingSettingsTab` takes the narrowed value. Handing it the raw
 * segment would put a client-supplied string into the authorization decision.
 * Nothing mutates before the gate: `await params` is a resolved route value,
 * not work.
 */

/**
 * GET /api/request/travel-booking/settings/[kind]
 * kind ∈ reasons | accommodations | vehicles | rent-vehicles
 * Returns the full list (including inactive) for the admin settings UI.
 * Requires IT Admin, System Admin, or a booking approver granted this tab.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isSettingsKind(kind)) {
    return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
  }

  const session = await requireBookingSettingsTab(kind);
  if (session instanceof Response) return session;

  try {
    const data = await SETTINGS_KIND_ROUTES[kind].list(false);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error(`[api/request/travel-booking/settings/${kind}] GET`, err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/request/travel-booking/settings/[kind]
 * Body: { id?, name, isActive?, sortOrder?, requiresCustomReason? }
 * Upserts one row of the given settings table.
 * Requires IT Admin, System Admin, or a booking approver granted this tab.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isSettingsKind(kind)) {
    return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
  }

  const session = await requireBookingSettingsTab(kind);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    if (!body?.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
    }
    await SETTINGS_KIND_ROUTES[kind].upsert(body, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error(`[api/request/travel-booking/settings/${kind}] POST`, err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
