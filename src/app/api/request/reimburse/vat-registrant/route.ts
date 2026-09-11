import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { lookupVatRegistrant } from "@/lib/clr/rd-vat-service";
import { TAX_ID_LENGTH, taxIdDigits } from "@/features/reimburse/lib/vendor-check";

/**
 * GET /api/request/reimburse/vat-registrant?taxId=0105566077543
 *
 * What the Revenue Department holds for a seller's tax id, for AP-4's expense
 * grid. `/api/request/clear-advance/vat-registrant` with AP-4's prefix.
 *
 * **A copy of AP-3's route rather than a call to it**, even though
 * `lookupVatRegistrant` is form-agnostic and the two handlers are nearly
 * identical. `/api/request/clear-advance` classifies as **AP-3** in
 * `ROUTE_RULES`, so an AP-4 screen calling that URL would have its form
 * database resolved by another form's switches — harmless for a lookup that
 * reads neither form database today, and exactly the sort of thing that stops
 * being harmless without anyone noticing. The prefix here classifies AP-4.
 *
 * `requireAuth()` and no object ACL, matching AP-3's: this reads a public
 * register with no credentials of ours, about a number printed on a receipt the
 * caller is already holding, and it takes a tax id rather than a request id —
 * there is no record here to authorize.
 *
 * `registrant: null` with ok:true is the answer "not on the VAT register" — a
 * fact about the receipt, not a failure. A genuine failure answers ok:false, so
 * an RD outage is never rendered as an unregistered seller.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const taxId = req.nextUrl.searchParams.get("taxId") ?? "";
  if (taxIdDigits(taxId).length !== TAX_ID_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `ต้องเป็นเลขผู้เสียภาษี ${TAX_ID_LENGTH} หลัก` },
      { status: 400 },
    );
  }

  try {
    const found = await lookupVatRegistrant(taxId, {
      refresh: req.nextUrl.searchParams.get("refresh") === "1",
    });
    if (!found) {
      return NextResponse.json(
        { ok: false, error: "ตรวจกับกรมสรรพากรไม่สำเร็จ — ลองใหม่อีกครั้ง" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, data: found });
  } catch (e) {
    console.error("[api/request/reimburse/vat-registrant] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
