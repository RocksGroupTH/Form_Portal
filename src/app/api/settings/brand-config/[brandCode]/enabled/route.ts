import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listBrandRegistry, saveBrandSetting } from "@/lib/brand-registry";

/**
 * PATCH /api/settings/brand-config/[brandCode]/enabled — offer this brand, or
 * stop offering it.
 *
 * **Its own route, not a field on the config PATCH beside it.** That one writes
 * `Fast_Core.dbo.BrandConfig`, a row the Rocks Fast and ACC Portal siblings
 * also read; this writes `Rocks_Portal_Form.dbo.BrandSetting`, which is ours
 * alone. Two different tables with two different audiences, so two endpoints —
 * and a card's toggle should not have to send a whole BC configuration to say
 * one boolean.
 *
 * Turning a brand off removes it from `/api/brands`, so the picker and the
 * navbar switcher stop offering it. It does **not** invalidate a cookie already
 * holding that brand: `BrandGate` compares the cookie against the list it
 * fetched and opens if it is not there, which is the same path a first-time
 * visitor takes.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ brandCode: string }> },
) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const { brandCode } = await params;
  const code = decodeURIComponent(brandCode).trim().toUpperCase();

  try {
    const brands = await listBrandRegistry();
    if (!code || !brands.some((b) => b.code === code)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as { isEnabled?: unknown } | null;
    if (typeof body?.isEnabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "isEnabled must be a boolean" }, { status: 400 });
    }

    await saveBrandSetting(code, { isEnabled: body.isEnabled }, Number(session.user?.id ?? 0));
    return NextResponse.json({ ok: true, data: { brandCode: code, isEnabled: body.isEnabled } });
  } catch (err) {
    console.error("[api/settings/brand-config/enabled] PATCH", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "บันทึกไม่สำเร็จ" }, { status: 500 });
  }
}
