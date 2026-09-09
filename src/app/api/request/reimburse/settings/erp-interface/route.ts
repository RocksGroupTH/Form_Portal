import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import { listFormBrands } from "@/lib/acc/settings-service";
import {
  loadReimburseErpInterfaceSettings,
  saveReimburseErpInterfaceSettings,
} from "@/lib/acc/reimburse/erp-interface-settings-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * AP-4's own Business Central posting configuration — journal batch, bank
 * account and branch code per claimable brand. `src/lib/adv/` — AP-2's own
 * equivalent route — mirrored here, and its shape is copied deliberately;
 * two things differ, both on purpose.
 *
 * **Admin-only on both methods, not `requireReimburseSettingsTab`.** AP-4's
 * `erpInterface` tab is deliberately excluded from `GRANTABLE_REIMBURSE_TABS`
 * — see that module's docblock. `gl-accounts` / `bank-accounts` /
 * `journal-batches` / `branch-codes` are tab-gated on AP-1 but not
 * brand-scoped, so a brand-scoped grant holder there could set another
 * brand's posting configuration (CLAUDE.md, "Do not grant `erpInterface` to a
 * non-admin yet"). AP-4's own config carries the identical gap — nothing here
 * checks `AccApproverInterfaceBrand` or any AP-4 counterpart of it — so this
 * route stays `requireRole` outright rather than opening the same hole to a
 * non-admin who only happens to hold the AP-4 grant.
 *
 * **The brand allow-list comes from `listFormBrands("AP-4")`, resolved here,
 * never taken off the request body.**
 * `saveReimburseErpInterfaceSettings`'s own docblock says outright that it
 * does not call `assertClaimBrandAllowed` and hands that obligation to this
 * route — a POST naming a brand AP-4 has never been granted must not create a
 * row.
 */

const SETTINGS_ROLES = ["IT Admin", "System Admin"] as const;

/** GET — one row per brand AP-4 has ever been granted, active or not. */
export async function GET() {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;
  try {
    const data = await loadReimburseErpInterfaceSettings();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reimburse/settings/erp-interface] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST — save Company ปลายทาง + Bank Account + Branch + Journal Batch for one brand. */
export async function POST(req: NextRequest) {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      brandCode?: string;
      interfaceBrandCode?: string;
      bankAccountNo?: string;
      branchCode?: string;
      journalBatchName?: string;
    };

    const brandCode = (body.brandCode ?? "").trim().toUpperCase();
    if (!brandCode) {
      return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์" }, { status: 400 });
    }

    // Never trust the body for which brands AP-4 may configure — the same
    // rows the panel's own GET reads, so a brand that has never been granted
    // to AP-4 (or whose grant was since revoked and never re-added) cannot be
    // written here either, whatever the body names.
    const claimable = await listFormBrands(AP4_FORM_CODE);
    const allowedBrandCodes = new Set(claimable.map((b) => b.brandCode.toUpperCase()));
    if (!allowedBrandCodes.has(brandCode)) {
      return NextResponse.json(
        { ok: false, error: "แบรนด์นี้ไม่ได้อยู่ในสิทธิ์ของ AP-4" },
        { status: 400 },
      );
    }

    const interfaceBrandCode = (body.interfaceBrandCode ?? "").trim();
    if (!interfaceBrandCode) {
      return NextResponse.json({ ok: false, error: "กรุณาเลือก Company ปลายทาง" }, { status: 400 });
    }
    if (!isErpInterfaceBrandCode(interfaceBrandCode)) {
      return NextResponse.json({ ok: false, error: "Company ปลายทางไม่ถูกต้อง" }, { status: 400 });
    }

    const bankAccountNo = (body.bankAccountNo ?? "").trim();
    const branchCode = (body.branchCode ?? "").trim() || null;
    const journalBatchName = (body.journalBatchName ?? "").trim() || null;
    if (!bankAccountNo) {
      return NextResponse.json({ ok: false, error: "กรุณาเลือก Bank Account" }, { status: 400 });
    }

    await saveReimburseErpInterfaceSettings(
      { brandCode, interfaceBrandCode, bankAccountNo, branchCode, journalBatchName },
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reimburse/settings/erp-interface] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
