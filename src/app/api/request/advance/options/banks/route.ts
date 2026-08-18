import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listBanks } from "@/lib/adv/bank-master-service";

/** GET /api/request/advance/options/banks — payee bank list (AP2.1 master) */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const data = await listBanks();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error("[api/request/advance/options/banks] GET", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
