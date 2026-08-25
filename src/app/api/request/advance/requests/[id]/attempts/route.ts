import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listAttempts } from "@/lib/adv/advance-erp-attempt-service";

/** GET — send-attempt history (ADV↔PV mapping) for one AP-2 request. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const { id } = await params;
  const rid = Number(id);
  if (!Number.isFinite(rid)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  try {
    const data = await listAttempts(rid);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
