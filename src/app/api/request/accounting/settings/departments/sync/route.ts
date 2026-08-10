import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  syncAllBrandDepartmentDimensions,
  syncBrandDepartmentDimension,
} from "@/lib/acc/department-map-service";

/** POST /api/request/accounting/settings/departments/sync — optional { brandCode } */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json().catch(() => ({}));
    const brandCode = (body.brandCode as string | undefined)?.trim();

    if (brandCode) {
      const data = await syncBrandDepartmentDimension(brandCode, Number(session.user.id));
      return NextResponse.json({ ok: true, data });
    }

    const data = await syncAllBrandDepartmentDimensions(Number(session.user.id));
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/.../departments/sync] POST", err);
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
