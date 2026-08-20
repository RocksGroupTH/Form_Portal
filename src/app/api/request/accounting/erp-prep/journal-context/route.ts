import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { DEFAULT_ERP_JOURNAL_DESC_TEMPLATE } from "@/lib/acc/erp-journal-description";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/**
 * GET /api/request/accounting/erp-prep/journal-context
 * Brand ERP account config + description template for journal preview.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessAccountArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    // The journal preview on the ERP Prep screen, and ERP Prep is AP-1 — the
    // queue behind it is `listErpPrepRows`, pinned to `r.FormCode = 'AP-1'`,
    // and CLAUDE.md classifies this route AP-1 rather than BOTH for the same
    // reason. The preview must therefore resolve the configuration the send
    // will actually use, or an operator approves a payload that is not the one
    // that posts.
    const ctx = await loadErpJournalBuildContext(AP1_FORM_CODE);
    return NextResponse.json({
      ok: true,
      data: {
        ...ctx,
        defaultTemplate: DEFAULT_ERP_JOURNAL_DESC_TEMPLATE,
      },
    });
  } catch (err) {
    console.error("[api/request/accounting/erp-prep/journal-context] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
