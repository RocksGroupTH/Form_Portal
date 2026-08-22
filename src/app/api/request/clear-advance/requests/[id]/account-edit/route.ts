import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/clr/clear-advance-request-service";
import { saveAccountEdit } from "@/lib/clr/clear-advance-request-service";
import { isClrApprover } from "@/lib/clr/clear-advance-approver-service";
import { isAdminRole } from "@/lib/roles";
import type { ClearAdvanceSaveInput } from "@/features/clear-advance/types";

/* ── PUT /api/request/clear-advance/requests/[id]/account-edit ── */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const clrReq = await getRequest(id);
  if (!clrReq) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const allowed =
    (await isClrApprover(session.user.email ?? null, "ACCOUNT")) ||
    isAdminRole(session.user.role);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "ไม่มีสิทธิ์แก้ไขขั้นบัญชี" },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json()) as ClearAdvanceSaveInput;
    body.id = id;
    await saveAccountEdit(body, Number(session.user.id), session.user.email ?? "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
