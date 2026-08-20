import { NextRequest, NextResponse } from "next/server";
import { requireSettingsTab } from "@/lib/acc/require-settings-tab";
import {
  saveDepartmentMappings,
  type SaveDepartmentMappingInput,
} from "@/lib/acc/department-map-service";

/**
 * PUT /api/request/accounting/settings/departments — save HR ↔ ERP mappings.
 *
 * Requires an admin, or the `departments` settings-tab grant.
 *
 * ⚠️ This is the one granted settings route that writes outside the form
 * database: `saveDepartmentMappings` opens the core pool and upserts
 * `DepartmentErpMap`, which lives in the configuration database shared with the
 * Rocks Fast sibling. The plan grants it deliberately — a แผนก tab that lists
 * mappings but cannot save one is the grant-that-grants-nothing this change
 * exists to remove — but it is the mapping to revisit first if that shared
 * database ever has to be closed to non-admins. The two `sync` POSTs, which
 * write the ERP reporting database, stayed on `requireRole` for exactly that
 * reason.
 */
export async function PUT(req: NextRequest) {
  const session = await requireSettingsTab("departments");
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
