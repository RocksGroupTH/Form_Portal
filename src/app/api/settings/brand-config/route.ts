import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listBrandConfigLookups, listBrandConfigs } from "@/lib/brand-config";

export async function GET() {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const userId = Number(session.user?.id ?? 0);
    const [configs, lookups] = await Promise.all([
      listBrandConfigs(userId),
      listBrandConfigLookups(),
    ]);

    return NextResponse.json({
      ok: true,
      data: { configs, lookups },
    });
  } catch (err) {
    console.error("[api/settings/brand-config] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
