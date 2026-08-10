import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { orsGeocode, orsSearch } from "@/lib/ors";

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  // `mode=search` → full-text (matches anywhere); default → prefix autocomplete.
  const mode = req.nextUrl.searchParams.get("mode");
  try {
    const data = mode === "search" ? await orsSearch(q) : await orsGeocode(q);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "geocode error" },
      { status: 500 },
    );
  }
}
