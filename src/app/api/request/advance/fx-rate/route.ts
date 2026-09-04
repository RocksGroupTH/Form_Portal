import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchFxRate } from "@/lib/adv/bot-fx";

/**
 * GET /api/request/advance/fx-rate?currency=USD[&date=YYYY-MM-DD]
 *
 * The Bank of Thailand **selling** rate when `BOT_API_CLIENT_ID` is set — the
 * side of the spread the company pays to buy a foreign currency — and a keyless
 * ECB mid-market figure when it is not. The response carries `source` either
 * way, and callers caption the figure from that field rather than assuming a
 * provider, so neither caption goes stale when the key is added or expires.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const currency = req.nextUrl.searchParams.get("currency");
  const date = req.nextUrl.searchParams.get("date") || undefined;
  if (!currency) {
    return NextResponse.json({ ok: false, error: "ระบุสกุลเงิน" }, { status: 400 });
  }

  try {
    const data = await fetchFxRate(currency, date);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 502 },
    );
  }
}
