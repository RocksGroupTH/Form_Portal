import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import { resolveSettingsErpEnvironment } from "@/lib/acc/erp-environment";
import {
  listBrandJournalBatches,
  upsertBrandJournalBatch,
} from "@/lib/acc/brand-journal-batch-service";

/**
 * AP-1's Journal Batch settings, per Business Central environment since
 * migration 161.
 *
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
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const brand = req.nextUrl.searchParams.get("brand");
    // Which BC half this touches follows the navbar's PRO/UAT switch, never a
    // query string — see resolveSettingsErpEnvironment for why this route
    // cannot use the ordinary resolver.
    const environment = await resolveSettingsErpEnvironment();

    const data = await listBrandJournalBatches(brand, undefined, environment);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/journal-batches] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSettingsTab("erpInterface");
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    // Which BC half this touches follows the navbar's PRO/UAT switch, never a
    // query string — see resolveSettingsErpEnvironment for why this route
    // cannot use the ordinary resolver.
    const environment = await resolveSettingsErpEnvironment();

    // Parsed rather than spread through: the body reaches the service as its
    // input object, so an unvalidated `environment` would be written into the
    // column verbatim and into the unique key with it.
    await upsertBrandJournalBatch({ ...body, environment }, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error("[api/request/accounting/settings/journal-batches] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
