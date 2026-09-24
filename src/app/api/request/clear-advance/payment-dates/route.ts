import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getPaymentDates, getDefaultPaymentDate } from "@/lib/acc/payment-calendar";

/**
 * GET /api/request/clear-advance/payment-dates — AP-3's payable Fridays + default.
 *
 * AP-3 read AP-2's `/api/request/advance/payment-dates` until 2026-09-24, which
 * was harmless only while the two forms shared a calendar. AP-2 now pays every
 * Friday and AP-3 still pays on the 2nd and the 4th, so a borrowed list offered
 * accounting dates AP-3 does not pay on — and, worse, stopped `paymentDateOffCycle`
 * warning about the ones it does not.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const [dates, def] = await Promise.all([
      getPaymentDates("AP-3"),
      getDefaultPaymentDate("AP-3"),
    ]);
    return NextResponse.json({ ok: true, data: { dates, default: def } });
  } catch (err) {
    console.error("[api/request/clear-advance/payment-dates] GET", err);
    return NextResponse.json({ ok: false, error: "ดึงรอบวันจ่ายไม่สำเร็จ" }, { status: 500 });
  }
}
