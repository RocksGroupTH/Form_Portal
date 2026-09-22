import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listClrInterfaceConfigView } from "@/lib/clr/clear-advance-interface-settings-service";
import { saveClrBatch, saveClrErpAccounts } from "@/lib/clr/clear-advance-interface-config-service";
import { saveClrBankAccount } from "@/lib/clr/clear-advance-bank-account";

/** GET — per-brand AP-3 Interface ERP view (inherited target + AP-3's Journal Batch). */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const data = await listClrInterfaceConfigView();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-interface] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST — save AP-3's Journal Batch for one brand. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      brandCode?: string;
      journalBatchName?: string;
      vatInputGlAccountNo?: string | null;
      whtPayableGlAccountNo?: string | null;
      bankAccountNo?: string;
    };
    const brandCode = (body.brandCode ?? "").trim();
    if (!brandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์" }, { status: 400 });
    const uid = Number(session.user.id);
    if (body.journalBatchName !== undefined) {
      await saveClrBatch(brandCode, (body.journalBatchName ?? "").trim(), uid);
    }
    if (body.vatInputGlAccountNo !== undefined || body.whtPayableGlAccountNo !== undefined) {
      await saveClrErpAccounts(brandCode, body.vatInputGlAccountNo ?? null, body.whtPayableGlAccountNo ?? null, uid);
    }
    if (body.bankAccountNo !== undefined) {
      // Unlike the two tax accounts above, blank is NOT treated as "clear the
      // setting" here: AP-3 cannot send a claim without a bank to post
      // against, so an empty value is rejected rather than silently accepted
      // as "no override".
      const bankAccountNo = body.bankAccountNo.trim();
      if (!bankAccountNo) {
        return NextResponse.json({ ok: false, error: "กรุณาระบุเลขบัญชีธนาคาร" }, { status: 400 });
      }
      if (bankAccountNo.length > 50) {
        return NextResponse.json(
          { ok: false, error: "เลขบัญชีธนาคารต้องไม่เกิน 50 ตัวอักษร" },
          { status: 400 },
        );
      }
      await saveClrBankAccount(brandCode, bankAccountNo, uid);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-interface] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
