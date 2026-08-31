import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { orsGeocode, orsSearch } from "@/lib/ors";
import { resolveOrsCountry } from "@/lib/ors-scope";

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  // `mode=search` → full-text (matches anywhere); default → prefix autocomplete.
  const mode = req.nextUrl.searchParams.get("mode");
  // `country` is caller-supplied text on its way into an upstream URL, so it
  // goes through `resolveOrsCountry`, which admits a two-letter code or the "*"
  // sentinel and narrows everything else to TH. Absent means TH, which is what
  // keeps AP-1's map picker (`LeafletRoutePicker`, no `country` param) behaving
  // exactly as it did.
  const country = resolveOrsCountry(req.nextUrl.searchParams.get("country"));
  try {
    const data = mode === "search" ? await orsSearch(q, country) : await orsGeocode(q, country);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "geocode error" },
      { status: 500 },
    );
  }
}
