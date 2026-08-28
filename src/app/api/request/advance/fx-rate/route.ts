import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchFxRate } from "@/lib/adv/bot-fx";

/**
 * GET /api/request/advance/fx-rate?currency=USD[&date=YYYY-MM-DD]
 *
 * A **mid-market reference rate**, not a Bank of Thailand buying-transfer rate:
 * `BOT_API_CLIENT_ID` is deliberately unprovisioned, so `fetchFxRate` always
 * takes its keyless ECB fallback. The response carries `source`, and no caller
 * may caption the figure as a BOT rate — see `src/lib/acc/currency-display.ts`.
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
