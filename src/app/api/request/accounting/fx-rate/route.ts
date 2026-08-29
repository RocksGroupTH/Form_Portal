import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveRate } from "@/lib/acc/fx";

/**
 * GET /api/request/accounting/fx-rate?currency=MYR
 *
 * The rate AP-1's form shows beside a foreign expense line — **for display
 * only**. Nothing here is ever stored, and the client never posts a rate back:
 * `request-service.ts` fetches its own on every save, which is the one part of
 * AP-2's approach deliberately not reused (AP-2's browser posts a rate and
 * `advance-request-service.ts` stores it unverified).
 *
 * So this is a convenience, not an authority. If it fails the line's converted
 * figure simply reads `—`; the save is unaffected either way, and refuses on its
 * own if its own fetch fails.
 *
 * **A mid-market reference rate, not a Bank of Thailand rate.**
 * `BOT_API_CLIENT_ID` is deliberately unprovisioned, so `resolveRate` always
 * takes `bot-fx`'s keyless ECB fallback. No screen may caption the figure as a
 * BOT rate — `อัตราอ้างอิง`; see `src/lib/acc/currency-display.ts`.
 *
 * `ROUTE_RULES` needs no entry: `/api/request/accounting` already classifies
 * `AP-1`, and this route reads no database at all.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const currency = req.nextUrl.searchParams.get("currency");
  if (!currency) {
    return NextResponse.json({ ok: false, error: "ระบุสกุลเงิน" }, { status: 400 });
  }

  // `resolveRate` already swallows the timeout, the outage and the currency the
  // provider does not carry, and answers null for all three — the same refusal
  // the save acts on. A 502 here is a note to the form, not an error to report.
  const fx = await resolveRate(currency);
  if (!fx) {
    return NextResponse.json(
      { ok: false, error: "ไม่สามารถดึงอัตราแลกเปลี่ยนได้ในขณะนี้" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, data: fx });
}
