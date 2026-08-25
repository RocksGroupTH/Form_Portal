import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import { listAdvanceInterfaceConfigView, saveAdvanceInterfacePerForm } from "@/lib/adv/advance-interface-settings-service";

/** GET — per-brand AP-2 Interface ERP config (AP-2's own + inherited display). */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const data = await listAdvanceInterfaceConfigView();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-interface] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST — save AP-2's G/L + Bank + Journal Batch for one brand in a single write. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      brandCode?: string;
      interfaceBrandCode?: string;
      glAccountNo?: string;
      bankAccountNo?: string;
      branchCode?: string;
      journalBatchName?: string;
    };
    const brandCode = (body.brandCode ?? "").trim();
    if (!brandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์" }, { status: 400 });

    const interfaceBrandCode = (body.interfaceBrandCode ?? "").trim();
    if (!interfaceBrandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือก Company ปลายทาง" }, { status: 400 });
    if (!isErpInterfaceBrandCode(interfaceBrandCode)) return NextResponse.json({ ok: false, error: "Company ปลายทางไม่ถูกต้อง" }, { status: 400 });

    const glAccountNo    = (body.glAccountNo ?? "").trim();
    const bankAccountNo  = (body.bankAccountNo ?? "").trim();
    const branchCode     = (body.branchCode ?? "").trim() || null;
    const journalBatchName = (body.journalBatchName ?? "").trim() || null;
    if (!glAccountNo)   return NextResponse.json({ ok: false, error: "กรุณาเลือก G/L Account" }, { status: 400 });
    if (!bankAccountNo) return NextResponse.json({ ok: false, error: "กรุณาเลือก Bank Account" }, { status: 400 });

    await saveAdvanceInterfacePerForm(
      brandCode,
      { interfaceBrandCode, glAccountNo, bankAccountNo, branchCode, journalBatchName },
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-interface] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
