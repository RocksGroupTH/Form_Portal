import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { deleteItem } from "@/lib/acc/request-service";

/* ── DELETE /api/request/accounting/requests/[id]/items/[itemId] ──
   Remove a single expense item (and its attachments) from an editable draft. */

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId, itemId: rawItemId } = await params;
  const id = Number(rawId);
  const itemId = Number(rawItemId);
  if (Number.isNaN(id) || Number.isNaN(itemId)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    await deleteItem(id, itemId, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
