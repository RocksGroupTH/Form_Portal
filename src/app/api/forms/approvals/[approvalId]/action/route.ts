import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { processApprovalAction } from "@/features/forms/workflow-engine";

type RouteParams = { params: Promise<{ approvalId: string }> };

/* ── POST /api/forms/approvals/[approvalId]/action ── */

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const userId = Number(session.user.id);

    const { approvalId } = await params;
    const id = Number(approvalId);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid approvalId" },
        { status: 400 },
      );
    }

    const body = await req.json();
    const { action, comment } = body;

    const validActions = ["approve", "reject", "return"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { ok: false, error: "Action must be one of: approve, reject, return" },
        { status: 400 },
      );
    }

    const result = await processApprovalAction(id, action, comment, userId);

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/forms] POST approvals/[approvalId]/action", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
