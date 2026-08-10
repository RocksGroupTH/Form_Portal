import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isSettingsKind, SETTINGS_KIND_ROUTES } from "@/lib/acc/travel-booking/settings-route-map";

/**
 * POST /api/request/travel-booking/settings/[kind]/reorder
 * Body: { orderedIds: number[] }
 * Persists a new display order (SortOrder = index in the array).
 * Requires IT Admin or System Admin.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const { kind } = await params;
  if (!isSettingsKind(kind)) {
    return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
  }

  try {
    const body = (await req.json()) as { orderedIds?: number[] };
    if (!Array.isArray(body.orderedIds)) {
      return NextResponse.json({ ok: false, error: "orderedIds required" }, { status: 400 });
    }
    await SETTINGS_KIND_ROUTES[kind].reorder(body.orderedIds.map((n) => Number(n)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[api/request/travel-booking/settings/${kind}/reorder] POST`, err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
