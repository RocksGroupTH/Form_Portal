import { NextRequest, NextResponse } from "next/server";
import { requireAdvClrSettingsTab } from "@/lib/adv/require-adv-clr-settings-tab";
import { listClrErpBankAccountsForCompany } from "@/lib/clr/clear-advance-admin-service";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";

/** GET active Bank Account cards from Rocks_ERP_Data.dbo.ErpBankAccountCard.
 *  ?company=PCTH — an already-resolved target Company, the only accepted
 *    form. Unlike the neighbouring erp-journal-batches route, there is no
 *    ?brand= fallback here: a picker resolving the company through a path
 *    the send does not use is how a journal gets pointed at a bank its
 *    target company does not have. An absent or unrecognised company
 *    answers an empty list without ever calling the reader. */
/* Gated on `clearErpInterface`, like the Journal Batch and G/L option lists
   this sits beside — it is the list AP-3’s Interface ERP tab picks a bank
   from, and a holder who may choose the batch may choose the bank. Like
   them it is gated but NOT brand-scoped: a holder reads any company’s
   cards. It writes nothing; the chosen value is saved by the neighbouring
   erp-interface POST. (user, 2026-09-23) */
export async function GET(req: NextRequest) {
  const session = await requireAdvClrSettingsTab("clearErpInterface");
  if (session instanceof Response) return session;
  try {
    const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
    if (!company || !isErpInterfaceBrandCode(company)) {
      return NextResponse.json({ ok: true, data: [] });
    }
    const data = await listClrErpBankAccountsForCompany(company);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-bank-accounts] GET", err);
    return NextResponse.json({ ok: false, error: "ดึงบัญชีธนาคารไม่สำเร็จ" }, { status: 500 });
  }
}
