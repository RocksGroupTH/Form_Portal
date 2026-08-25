import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { deleteBank } from "@/lib/adv/bank-master-service";

/** DELETE — hard-remove a bank. IT/System Admin only. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "id ไม่ถูกต้อง" }, { status: 400 });
  }
  try {
    await deleteBank(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/banks/[id]] DELETE", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
