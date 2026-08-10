import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  clearBrandErpInterfaceTarget,
  getBrandErpConfigPage,
  updateBrandErpInterfaceTarget,
} from "@/lib/acc/brand-erp-config-service";

export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const data = await getBrandErpConfigPage();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/erp-config] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const brandCode = body.brandCode as string;
    if (!brandCode?.trim()) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุแบรนด์เบิก" }, { status: 400 });
    }

    const interfaceBrandCode = (body.interfaceBrandCode as string | null)?.trim() || null;
    if (!interfaceBrandCode) {
      return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์ปลายทาง" }, { status: 400 });
    }

    const data = await updateBrandErpInterfaceTarget(
      brandCode.trim(),
      interfaceBrandCode,
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error("[api/request/accounting/settings/erp-config] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const brandCode = req.nextUrl.searchParams.get("brandCode")?.trim();
    if (!brandCode) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุแบรนด์เบิก" }, { status: 400 });
    }

    await clearBrandErpInterfaceTarget(brandCode);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof Error ? 400 : 500;
    console.error("[api/request/accounting/settings/erp-config] DELETE", err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
