import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchSupportedCurrencies } from "@/lib/adv/bot-fx";

/** GET — currencies supported by the FX source, for the currency dropdown. */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await fetchSupportedCurrencies() });
  } catch (err) {
    console.error("[api/request/advance/currencies] GET", err);
    return NextResponse.json({ ok: false, error: "ดึงรายการสกุลเงินไม่สำเร็จ" }, { status: 502 });
  }
}
