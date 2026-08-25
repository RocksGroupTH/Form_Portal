import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listExpenseAccounts } from "@/lib/acc/reimburse/expense-account-service";

/**
 * GET /api/request/reimburse/options/expense-accounts?brand=PCTH — the G/L
 * accounts an AP-4 line may be booked to, for the picker in the `รายการ`
 * column.
 *
 * `requireAuth()`, like the brands endpoint beside it: the list is what the
 * form draws, so every requester needs it, and it says nothing the picker
 * itself would not. It is a company's chart of accounts, not anybody's
 * personal data, and the filtering that matters — expense and cost-of-sales,
 * postable accounts only — happens in the service.
 *
 * **`brand` is required rather than defaulted.** `ErpAccounts` is keyed on
 * `BrandCode`, and quietly answering for some other brand would offer accounts
 * a claim cannot post to. A claim with no brand chosen yet gets an explicit
 * 400, which the form turns into "เลือกแบรนด์ก่อน" rather than an empty picker
 * with no explanation.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/reimburse` prefix already
 * classifies as `AP-4`. The read itself is `getErpDataPool()`, one physical
 * copy with no UAT twin, so the classification changes nothing here — it is
 * recorded because the next person to add a route under this prefix will ask.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const brand = req.nextUrl.searchParams.get("brand")?.trim();
  if (!brand) {
    return NextResponse.json(
      { ok: false, error: "กรุณาเลือกแบรนด์ที่เบิกก่อน" },
      { status: 400 },
    );
  }

  try {
    const data = await listExpenseAccounts(brand);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("GET /api/request/reimburse/options/expense-accounts error:", e);
    return NextResponse.json({ ok: false, error: "โหลดรายการบัญชีไม่สำเร็จ" }, { status: 500 });
  }
}
