import { NextRequest, NextResponse } from "next/server";
import { requireAdvClrSettingsTab } from "@/lib/adv/require-adv-clr-settings-tab";
import { listClrInterfaceConfigView } from "@/lib/clr/clear-advance-interface-settings-service";
import { saveClrBatch, saveClrErpAccounts } from "@/lib/clr/clear-advance-interface-config-service";
import { saveClrBankAccount } from "@/lib/clr/clear-advance-bank-account";
import { resolveSettingsErpEnvironment } from "@/lib/acc/erp-environment";

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
  const session = await requireAdvClrSettingsTab("clearErpInterface");
  if (session instanceof Response) return session;
  try {
    // Which BC half this touches follows the navbar's PRO/UAT switch, never a
    // query string — see resolveSettingsErpEnvironment for why this route
    // cannot use the ordinary resolver.
    const environment = await resolveSettingsErpEnvironment();

    const data = await listClrInterfaceConfigView(environment);
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
      bankAccountNo?: string;
    };
    const brandCode = (body.brandCode ?? "").trim();
    if (!brandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์" }, { status: 400 });
    const uid = Number(session.user.id);
    // Which BC half this touches follows the navbar's PRO/UAT switch, never a
    // query string — see resolveSettingsErpEnvironment for why this route
    // cannot use the ordinary resolver.
    const environment = await resolveSettingsErpEnvironment();

    // Validated up front, before any of the three writes below run. Unlike
    // the two tax accounts, blank is NOT treated as "clear the setting" here
    // — AP-3 cannot send a claim without a bank to post against, so a
    // missing/blank/oversized/non-string value is refused outright. Doing
    // that refusal before saveClrBatch/saveClrErpAccounts write anything
    // keeps a bad bank from leaving a half-saved brand (batch + tax accounts
    // committed, bank refused, client shown a failure over a server that
    // already moved).
    let bankAccountNo: string | undefined;
    if (body.bankAccountNo !== undefined) {
      if (typeof body.bankAccountNo !== "string") {
        return NextResponse.json({ ok: false, error: "รูปแบบเลขบัญชีธนาคารไม่ถูกต้อง" }, { status: 400 });
      }
      bankAccountNo = body.bankAccountNo.trim();
      if (!bankAccountNo) {
        return NextResponse.json({ ok: false, error: "กรุณาระบุเลขบัญชีธนาคาร" }, { status: 400 });
      }
      if (bankAccountNo.length > 50) {
        return NextResponse.json(
          { ok: false, error: "เลขบัญชีธนาคารต้องไม่เกิน 50 ตัวอักษร" },
          { status: 400 },
        );
      }
    }

    if (body.journalBatchName !== undefined) {
      await saveClrBatch(brandCode, (body.journalBatchName ?? "").trim(), uid);
    }
    if (body.vatInputGlAccountNo !== undefined || body.whtPayableGlAccountNo !== undefined) {
      await saveClrErpAccounts(brandCode, body.vatInputGlAccountNo ?? null, body.whtPayableGlAccountNo ?? null, uid);
    }
    if (bankAccountNo !== undefined) {
      await saveClrBankAccount(brandCode, bankAccountNo, uid, undefined, environment);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/clear-advance/settings/erp-interface] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
