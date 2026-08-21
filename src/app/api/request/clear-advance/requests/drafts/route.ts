import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listMyDrafts } from "@/lib/clr/clear-advance-request-service";

/** GET /api/request/clear-advance/requests/drafts — editable AP-3 drafts for current user */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data = await listMyDrafts(Number(session.user.id));
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
