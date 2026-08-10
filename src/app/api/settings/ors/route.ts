import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { setAppSetting } from "@/lib/app-settings";
import { resolveOrsKey } from "@/lib/ors";

function maskKey(key: string): string {
  if (key.length <= 4) return "••••";
  return `••••${key.slice(-4)}`;
}

/** GET — never returns the full key; only configured/masked/source. */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const { key, source } = await resolveOrsKey();
    return NextResponse.json({
      ok: true,
      data: { configured: !!key, masked: key ? maskKey(key) : null, source },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

/** POST { value } — save (or clear, falling back to env) the ORS key in Fast_Core. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { value?: string | null };
    const value = body.value?.trim() || null;
    await setAppSetting("ORS_API_KEY", value, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
