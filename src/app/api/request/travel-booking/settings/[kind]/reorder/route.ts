import { NextRequest, NextResponse } from "next/server";
import { isSettingsKind, SETTINGS_KIND_ROUTES } from "@/lib/acc/travel-booking/settings-route-map";
import { requireBookingSettingsTab } from "@/lib/acc/travel-booking/require-booking-settings-tab";

/**
 * POST /api/request/travel-booking/settings/[kind]/reorder
 * Body: { orderedIds: number[] }
 * Persists a new display order (SortOrder = index in the array).
 * Requires IT Admin, System Admin, or a booking approver granted this tab.
 *
 * Same order as the sibling route: narrow the `[kind]` segment with
 * `isSettingsKind` first, then gate on the narrowed value — the tab comes from
 * the URL, so it must never reach the gate unnarrowed.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isSettingsKind(kind)) {
    return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
  }

  const session = await requireBookingSettingsTab(kind);
  if (session instanceof Response) return session;

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
