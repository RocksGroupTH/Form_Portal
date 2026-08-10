import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveMapProviderStatus } from "@/lib/map-provider";

/** GET — map provider status for AP-1 (Google when ready, else ORS). */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await resolveMapProviderStatus();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
