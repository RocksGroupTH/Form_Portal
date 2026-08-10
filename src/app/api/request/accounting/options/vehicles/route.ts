import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listVehicles } from "@/lib/acc/settings-service";

export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await listVehicles(true);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
