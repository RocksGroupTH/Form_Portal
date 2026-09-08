import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { lookupVatRegistrant } from "@/lib/clr/rd-vat-service";

/**
 * GET /api/request/clear-advance/vat-registrant?taxId=0105560171921
 *
 * What the Revenue Department holds for a seller's tax id — the registered name,
 * the branch and the date they were approved to issue tax invoices.
 *
 * Any signed-in user: it reads a public register with no credentials of ours,
 * about a number printed on a receipt they are already holding, and it is the
 * requester filling the form who benefits most from the name being right.
 *
 * Answered from our own table whenever we have been told before — a registration
 * is not the kind of fact that goes stale on a timer, so a stored answer is kept
 * and reused rather than re-asked on a schedule. `?refresh=1` asks the RD again
 * and overwrites, for whoever doubts the name in front of them.
 *
 * `registrant: null` with ok:true is the answer "not on the VAT register" — a
 * fact about the invoice, not a failure. A genuine failure returns ok:false, so
 * an RD outage is never shown as an unregistered seller.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const taxId = req.nextUrl.searchParams.get("taxId") ?? "";
  if (taxId.replace(/\D/g, "").length !== 13) {
    return NextResponse.json({ ok: false, error: "ต้องเป็นเลขผู้เสียภาษี 13 หลัก" }, { status: 400 });
  }

  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const found = await lookupVatRegistrant(taxId, { refresh });
    if (!found) {
      return NextResponse.json(
        { ok: false, error: "ตรวจกับกรมสรรพากรไม่สำเร็จ — ลองใหม่อีกครั้ง" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, data: found });
  } catch (e) {
    console.error("[api/request/clear-advance/vat-registrant] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
