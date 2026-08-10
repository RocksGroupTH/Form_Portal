import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  saveDepartmentMappings,
  type SaveDepartmentMappingInput,
} from "@/lib/acc/department-map-service";

/** PUT /api/request/accounting/settings/departments — save HR ↔ ERP mappings */
export async function PUT(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = (await req.json()) as {
      targetBrandCode?: string;
      brandCode?: string;
      legacyClaimCodes?: string[];
      mappings?: SaveDepartmentMappingInput[];
    };
    const targetBrandCode = (body.targetBrandCode ?? body.brandCode)?.trim();
    if (!targetBrandCode) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุแบรนด์ปลายทาง" }, { status: 400 });
    }
    const mappings: SaveDepartmentMappingInput[] = (body.mappings ?? []).map((m) => ({
      departmentCode: m.departmentCode,
      departmentName: m.departmentName ?? null,
      erpCode: m.erpCode,
      erpDimensionCode: m.erpDimensionCode,
      fixedGlAccountNo: m.fixedGlAccountNo ?? null,
      fixedGlDescription: m.fixedGlDescription ?? null,
    }));
    const legacyClaimCodes = body.legacyClaimCodes ?? [];
    await saveDepartmentMappings(
      targetBrandCode,
      mappings,
      Number(session.user.id),
      legacyClaimCodes,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/.../departments] PUT", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
