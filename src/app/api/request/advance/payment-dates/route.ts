import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getPaymentDates, getDefaultPaymentDate } from "@/lib/acc/payment-calendar";

/** GET /api/request/advance/payment-dates — valid payment Fridays + default */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const [dates, def] = await Promise.all([getPaymentDates(), getDefaultPaymentDate()]);
    return NextResponse.json({ ok: true, data: { dates, default: def } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
