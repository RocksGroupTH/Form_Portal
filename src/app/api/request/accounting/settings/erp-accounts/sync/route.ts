import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  syncAllBrandErpAccounts,
  syncBrandErpAccounts,
  syncBrandErpBankAccounts,
  syncBrandErpGlAccounts,
  syncBrandErpJournalBatches,
} from "@/lib/erp/account-sync";
import {
  BRANCH_DIMENSION_CODE,
  syncBrandDimensionValues,
} from "@/lib/erp/dimension-sync";

/** POST /api/request/accounting/settings/erp-accounts/sync — optional { brandCode } */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json().catch(() => ({}));
    const brandCode = (body.brandCode as string | undefined)?.trim();
    const phase = (body.phase as string | undefined)?.trim().toLowerCase();

    if (brandCode) {
      if (phase === "journalbatch") {
        const data = await syncBrandErpJournalBatches(brandCode);
        return NextResponse.json({
          ok: true,
          data: {
            brandCode: data.brandCode,
            glRows: 0,
            bankRows: 0,
            branchRows: 0,
            journalBatchRows: data.journalBatchRows,
          },
        });
      }
      if (phase === "gl") {
        const data = await syncBrandErpGlAccounts(brandCode);
        return NextResponse.json({ ok: true, data: { ...data, bankRows: 0, branchRows: 0, journalBatchRows: 0 } });
      }
      if (phase === "bank") {
        const data = await syncBrandErpBankAccounts(brandCode);
        return NextResponse.json({ ok: true, data: { ...data, glRows: 0, branchRows: 0, journalBatchRows: 0 } });
      }
      if (phase === "branch") {
        const data = await syncBrandDimensionValues(
          brandCode,
          BRANCH_DIMENSION_CODE,
          null,
          { skipLog: true },
        );
        return NextResponse.json({
          ok: true,
          data: {
            brandCode: data.brandCode,
            glRows: 0,
            bankRows: 0,
            branchRows: data.rowsUpserted,
            journalBatchRows: 0,
          },
        });
      }
      const data = await syncBrandErpAccounts(brandCode, Number(session.user.id));
      return NextResponse.json({ ok: true, data });
    }

    const data = await syncAllBrandErpAccounts(Number(session.user.id));
    if (data.results.length === 0 && data.errors.length > 0) {
      return NextResponse.json({
        ok: false,
        error: data.errors.map((e) => `${e.brandCode}: ${e.error}`).join("; "),
        data,
      }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/erp-accounts/sync] POST", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
