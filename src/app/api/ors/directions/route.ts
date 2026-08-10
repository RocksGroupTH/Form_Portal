import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { orsRoute } from "@/lib/ors";

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as {
      origin?: { lat: number; lng: number };
      destination?: { lat: number; lng: number };
    };
    if (!body.origin || !body.destination) {
      return NextResponse.json({ ok: false, error: "origin and destination required" }, { status: 400 });
    }
    const data = await orsRoute(body.origin, body.destination);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "directions error" },
      { status: 500 },
    );
  }
}
