import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { DEFAULT_ERP_JOURNAL_DESC_TEMPLATE } from "@/lib/acc/erp-journal-description";

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
    const ctx = await loadErpJournalBuildContext();
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
