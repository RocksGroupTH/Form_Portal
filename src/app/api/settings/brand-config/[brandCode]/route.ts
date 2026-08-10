import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { updateBrandConfig, type BrandConfigInput } from "@/lib/brand-config";
import { BRANDS } from "@/lib/brand";

type RouteParams = { params: Promise<{ brandCode: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireRole(["IT Admin", "System Admin"]);
    if (session instanceof Response) return session;

    const { brandCode } = await params;
    const code = brandCode.toUpperCase();
    if (!BRANDS.some((b) => b.id === code && b.enabled)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }

    const body = (await req.json()) as BrandConfigInput;
    const userId = Number(session.user?.id ?? 0);
    const config = await updateBrandConfig(code, body, userId);
    if (!config) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: config });
  } catch (err) {
    console.error("[api/settings/brand-config/[brandCode]] PATCH", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
