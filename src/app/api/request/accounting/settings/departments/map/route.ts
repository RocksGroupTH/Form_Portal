import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { DepartmentMapBoundsError } from "@/lib/acc/department-map-guard";
import {
  saveDepartmentMappings,
  type SaveDepartmentMappingInput,
} from "@/lib/acc/department-map-service";

/**
 * PUT /api/request/accounting/settings/departments/map — save HR ↔ ERP mappings.
 *
 * **Admin-only, and deliberately not covered by the `departments` grant.** The
 * read beside it (`settings/departments`, GET) is granted; this write is not.
 *
 * `saveDepartmentMappings` opens the core pool and writes
 * `DepartmentErpMap`, which lives in the configuration database shared with the
 * Rocks Fast and ACC Portal siblings — both read it from their own
 * `erp-prep-service.ts`, the path that prepares financial journal postings. A
 * mapping changed here decides where two other applications post money, which
 * is more than a settings-tab grant should carry. Ruled 2026-08-20; recorded in
 * `SETTINGS_ROUTE_TABS` as `tab: null`.
 *
 * The service bounds the payload regardless of who is calling — the target must
 * be a real ERP interface brand and every `legacyClaimCodes` entry must name a
 * brand enabled in AP-1, both checked before the first write. An admin should
 * not be able to empty three applications' department mappings by accident
 * either. See `src/lib/acc/department-map-guard.ts`.
 */
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
    const legacyClaimCodes = body.legacyClaimCodes;
    if (legacyClaimCodes !== undefined && !Array.isArray(legacyClaimCodes)) {
      return NextResponse.json(
        { ok: false, error: "legacyClaimCodes ต้องเป็นรายการรหัสแบรนด์" },
        { status: 400 },
      );
    }
    const mappings: SaveDepartmentMappingInput[] = (body.mappings ?? []).map((m) => ({
      departmentCode: m.departmentCode,
      departmentName: m.departmentName ?? null,
      erpCode: m.erpCode,
      erpDimensionCode: m.erpDimensionCode,
      fixedGlAccountNo: m.fixedGlAccountNo ?? null,
      fixedGlDescription: m.fixedGlDescription ?? null,
    }));
    await saveDepartmentMappings(
      targetBrandCode,
      mappings,
      Number(session.user.id),
      legacyClaimCodes ?? [],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/.../departments/map] PUT", err);
    // A bounds refusal is a rejected body — an unknown target brand, or a purge
    // list naming a brand that is not enabled in AP-1 — and it is thrown before
    // the first write, so nothing has changed. Anything else is a fault.
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof DepartmentMapBoundsError ? err.status : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
