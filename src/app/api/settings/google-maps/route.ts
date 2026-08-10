import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { setAppSetting } from "@/lib/app-settings";
import { invalidateGoogleReadyCache } from "@/lib/map-provider";
import { resolveGoogleMapsKey } from "@/lib/google-maps";

function maskKey(key: string): string {
  if (key.length <= 4) return "••••";
  return `••••${key.slice(-4)}`;
}

/** GET — configured/masked/source only (never full key). */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const { key, source } = await resolveGoogleMapsKey();
    return NextResponse.json({
      ok: true,
      data: { configured: !!key, masked: key ? maskKey(key) : null, source },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

/** POST { value } — save or clear Google Maps key in Fast_Core. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { value?: string | null };
    const value = body.value?.trim() || null;
    await setAppSetting("GOOGLE_MAPS_API_KEY", value, Number(session.user.id));
    invalidateGoogleReadyCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
