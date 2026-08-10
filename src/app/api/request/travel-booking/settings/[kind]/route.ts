import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isSettingsKind, SETTINGS_KIND_ROUTES } from "@/lib/acc/travel-booking/settings-route-map";

/**
 * GET /api/request/travel-booking/settings/[kind]
 * kind ∈ reasons | accommodations | vehicles | rent-vehicles
 * Returns the full list (including inactive) for the admin settings UI.
 * Requires IT Admin or System Admin.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const { kind } = await params;
  if (!isSettingsKind(kind)) {
    return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
  }

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
 * Upserts one row of the given settings table. Requires IT Admin or System Admin.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const { kind } = await params;
  if (!isSettingsKind(kind)) {
    return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
  }

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
