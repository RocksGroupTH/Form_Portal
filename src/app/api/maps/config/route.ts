import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveGoogleMapsKey } from "@/lib/google-maps";

/** GET — browser Maps JS API key for authenticated users (not masked). */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const { key, source } = await resolveGoogleMapsKey();
    return NextResponse.json({
      ok: true,
      data: { apiKey: key ?? "", configured: !!key, source },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
