import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listErpQueueRows } from "@/lib/clr/clear-advance-erp-queue-service";

export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listErpQueueRows() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
