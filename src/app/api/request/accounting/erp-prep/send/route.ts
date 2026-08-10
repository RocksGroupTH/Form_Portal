import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { sendErpInterfaceBatch } from "@/lib/acc/erp-interface-send";
import { getRequestHost } from "@/lib/acc/erp-environment";

/**
 * POST /api/request/accounting/erp-prep/send
 * Send all ready documents for an interface target to Business Central (PPAP CreateFromJson).
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessAccountArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as {
      interfaceTarget?: string;
    };

    const interfaceTarget = body.interfaceTarget?.trim().toUpperCase() ?? "";

    if (!interfaceTarget) {
      return NextResponse.json(
        { ok: false, error: "ต้องระบุ interfaceTarget" },
        { status: 400 },
      );
    }

    const host = await getRequestHost();
    const data = await sendErpInterfaceBatch({
      interfaceTarget,
      role: session.user.role,
      host,
      userId: Number(session.user.id),
    });

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";
    console.error("[api/request/accounting/erp-prep/send] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
