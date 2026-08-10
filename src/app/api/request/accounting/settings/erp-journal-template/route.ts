import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  getErpJournalDescriptionTemplate,
  saveErpJournalDescriptionTemplate,
} from "@/lib/acc/erp-journal-context";
import {
  DEFAULT_ERP_JOURNAL_DESC_TEMPLATE,
  normalizeErpJournalDescTemplate,
} from "@/lib/acc/erp-journal-description";

/**
 * GET /api/request/accounting/settings/erp-journal-template
 * POST — save template (IT Admin+)
 */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const template = await getErpJournalDescriptionTemplate();
    return NextResponse.json({
      ok: true,
      data: {
        template,
        defaultTemplate: DEFAULT_ERP_JOURNAL_DESC_TEMPLATE,
      },
    });
  } catch (err) {
    console.error("[api/request/accounting/settings/erp-journal-template] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const raw = body.template as string | undefined;
    if (!raw?.trim()) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุ template" }, { status: 400 });
    }
    const template = await saveErpJournalDescriptionTemplate(
      normalizeErpJournalDescTemplate(raw),
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true, data: { template } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[api/request/accounting/settings/erp-journal-template] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
