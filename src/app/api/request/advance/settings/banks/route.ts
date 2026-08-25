import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listAllBanks, upsertBank } from "@/lib/adv/bank-master-service";

/** GET — full bank master (incl. inactive) for setup. IT/System Admin only. */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const data = await listAllBanks();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/banks] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST — upsert a bank. Body: { id?, bankCode, bankName?, isActive?, sortOrder? }. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    if (!body.id && !body.bankCode) {
      return NextResponse.json({ ok: false, error: "ต้องระบุรหัสธนาคาร" }, { status: 400 });
    }
    if (body.bankCode) body.bankCode = String(body.bankCode).trim();
    if (body.bankName) body.bankName = String(body.bankName).trim();
    await upsertBank(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/banks] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
