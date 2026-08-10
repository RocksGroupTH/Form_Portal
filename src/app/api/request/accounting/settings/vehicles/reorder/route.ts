import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { reorderVehicles } from "@/lib/acc/settings-service";

export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { ids?: number[] };
    if (!Array.isArray(body.ids)) {
      return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
    }
    await reorderVehicles(body.ids.map((n) => Number(n)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
