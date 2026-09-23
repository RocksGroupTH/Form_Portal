import { NextRequest, NextResponse } from "next/server";
import { requireAdvClrSettingsTab } from "@/lib/adv/require-adv-clr-settings-tab";
import { isErpInterfaceBrand } from "@/lib/acc/erp-interface-brands";
import { listAdvanceInterfaceConfigView, saveAdvanceInterfacePerForm } from "@/lib/adv/advance-interface-settings-service";
import { resolveSettingsErpEnvironment } from "@/lib/acc/erp-environment";

/**
 * **Gated on `advanceErpInterface` since 2026-09-22, not `requireRole`.** The
 * user opened Interface ERP to individual grant holders having been told what
 * it reaches: this route is gated but **not brand-scoped**, so a holder sets
 * the bank account, Journal Batch and Branch Code of **any** brand, not only
 * the brands they approve for. The grid prints that in Thai under the
 * checkbox. The admin arm is unchanged.
 *
 * **The key is `advanceErpInterface`, not `erpInterface`.** AP-3 has a tab of
 * the same name over different rows, and one shared key would have put it in
 * both forms' storable sets — taking away the disjointness the bounded save in
 * `setAdvClrAccessTabs` rests on. See `@/lib/adv/settings-tabs`.
 *
 * **`AdvClrBrandSettings` (the แบรนด์ที่เบิกได้ tab) reads this GET for its
 * row list**, and a `brands` grant does NOT satisfy this gate — a pre-existing
 * mismatch this change neither caused nor closed, since the payload carries
 * every brand's bank account and Journal Batch and a `brands` holder has no
 * business reading those.
 *
 * GET — per-brand AP-2 Interface ERP config (AP-2's own + inherited display).
 */
/**
 * **Which BC half this reads and writes follows the navbar's PRO/UAT switch**,
 * not a query string and not this route's own path. The user's rule,
 * 2026-09-24: *"UAT หรือ PRO ไม่ต้องเปลี่ยนตรงนี้ เพราะเปลี่ยนจากด้านบน navbar
 * อยู่แล้ว"* — one switch, where it already is.
 *
 * It comes from `resolveSettingsErpEnvironment()` rather than the ordinary
 * `resolveEffectiveErpEnvironment()`, which would answer Production however the
 * navbar is set: the settings prefix is pinned to `null` in `ROUTE_RULES` so a
 * config-row id is not read as an `AccRequest` id, and a `null` class resolves
 * Production outright. That pin is about which DATABASE answers; since
 * migration 161 the two halves are told apart by a COLUMN, so the rows can come
 * from Production's database while the half on screen follows the person.
 */
export async function GET(req: NextRequest) {
  const session = await requireAdvClrSettingsTab("advanceErpInterface");
  if (session instanceof Response) return session;
  try {
    // Which BC half this touches follows the navbar's PRO/UAT switch, never a
    // query string — see resolveSettingsErpEnvironment for why this route
    // cannot use the ordinary resolver.
    const environment = await resolveSettingsErpEnvironment();

    const data = await listAdvanceInterfaceConfigView(environment);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-interface] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST — save AP-2's Bank + Branch + Journal Batch for one brand in a single write. */
export async function POST(req: NextRequest) {
  const session = await requireAdvClrSettingsTab("advanceErpInterface");
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      brandCode?: string;
      interfaceBrandCode?: string;
      bankAccountNo?: string;
      branchCode?: string;
      journalBatchName?: string;
    };
    const brandCode = (body.brandCode ?? "").trim();
    if (!brandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์" }, { status: 400 });

    const interfaceBrandCode = (body.interfaceBrandCode ?? "").trim();
    if (!interfaceBrandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือก Company ปลายทาง" }, { status: 400 });
    if (!(await isErpInterfaceBrand(interfaceBrandCode))) return NextResponse.json({ ok: false, error: "Company ปลายทางไม่ถูกต้อง" }, { status: 400 });

    const bankAccountNo  = (body.bankAccountNo ?? "").trim();
    const branchCode     = (body.branchCode ?? "").trim() || null;
    const journalBatchName = (body.journalBatchName ?? "").trim() || null;
    if (!bankAccountNo) return NextResponse.json({ ok: false, error: "กรุณาเลือก Bank Account" }, { status: 400 });

    // Which BC half this touches follows the navbar's PRO/UAT switch, never a
    // query string — see resolveSettingsErpEnvironment for why this route
    // cannot use the ordinary resolver.
    const environment = await resolveSettingsErpEnvironment();

    await saveAdvanceInterfacePerForm(
      brandCode,
      { interfaceBrandCode, bankAccountNo, branchCode, journalBatchName },
      Number(session.user.id),
      environment,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-interface] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
