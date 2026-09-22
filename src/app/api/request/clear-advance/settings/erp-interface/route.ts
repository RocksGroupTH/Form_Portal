import { NextRequest, NextResponse } from "next/server";
import { requireAdvClrSettingsTab } from "@/lib/adv/require-adv-clr-settings-tab";
import { listClrInterfaceConfigView } from "@/lib/clr/clear-advance-interface-settings-service";
import { saveClrBatch, saveClrErpAccounts } from "@/lib/clr/clear-advance-interface-config-service";

/**
 * **Gated on `clearErpInterface` since 2026-09-22, not `requireRole`.** The
 * user opened Interface ERP to individual grant holders having been told what
 * it reaches: this route is gated but **not brand-scoped**, so a holder sets
 * the Journal Batch and the two tax accounts of **any** brand, not only the
 * brands they approve for. The grid prints that in Thai under the checkbox.
 * The admin arm is unchanged.
 *
 * **The key is `clearErpInterface`, not `erpInterface`** — AP-2 has a tab of
 * the same name over different rows; see `@/lib/adv/settings-tabs` for why one
 * shared key would have broken the bounded save's per-form partition.
 *
 * GET — per-brand AP-3 Interface ERP view (inherited target + AP-3's Journal Batch).
 */
export async function GET() {
  const session = await requireAdvClrSettingsTab("clearErpInterface");
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
  const session = await requireAdvClrSettingsTab("clearErpInterface");
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      brandCode?: string;
      journalBatchName?: string;
      vatInputGlAccountNo?: string | null;
      whtPayableGlAccountNo?: string | null;
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
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-interface] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
