import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listAdvanceErpQueue } from "@/lib/adv/advance-queue-service";

/** GET — approved AP-2 requests ready for (or already sent to) BC, per Company. */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await listAdvanceErpQueue();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/erp-queue] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
