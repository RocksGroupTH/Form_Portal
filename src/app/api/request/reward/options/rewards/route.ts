import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listRewards } from "@/lib/acc/reward/settings-service";

/* ── GET /api/request/reward/options/rewards?brand=PCTH[&all=1] ── */

/**
 * The reward catalogue for the picker.
 *
 * `brand` is required: rewards are brand-scoped, and a catalogue with no brand
 * would offer a requester stock belonging to another company. `all=1` drops the
 * selectable filter and is what the settings page asks for — a closed or
 * exhausted reward still has to be visible to whoever manages it.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { searchParams } = new URL(req.url);
  const brandCode = searchParams.get("brand");
  const includeAll = searchParams.get("all") === "1";

  if (!brandCode) {
    return NextResponse.json({ ok: false, error: "brand is required" }, { status: 400 });
  }

  try {
    const data = await listRewards({ brandCode, selectableOnly: !includeAll });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/options/rewards] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
