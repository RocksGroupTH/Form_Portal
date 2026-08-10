import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { listMyTravelBookings, saveTravelBookingDraft } from "@/lib/acc/travel-booking/request-service";
import type { SaveTravelBookingGroupInput } from "@/features/travel-booking/types";

/* ── GET /api/request/travel-booking/requests — requester's own AP-17 requests ── */

export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data = await listMyTravelBookings(Number(session.user.id));
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/* ── POST /api/request/travel-booking/requests — save a (new or existing) draft group ── */

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const body = (await req.json()) as SaveTravelBookingGroupInput;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    const data = await saveTravelBookingDraft(body, Number(session.user.id), loginEmail);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
