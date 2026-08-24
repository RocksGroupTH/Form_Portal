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
 * `saveDepartmentMappings` writes `DepartmentErpMap` — which since migrations
 * 099/100 lives in this app's own form database, reached from `Fast_Core` by a
 * synonym. That is a change of address and nothing more: the Rocks Fast and ACC
 * Portal siblings read the same rows through that synonym, from their own
 * `erp-prep-service.ts`, the path that prepares financial journal postings. A
 * mapping changed here decides where two other applications post money, which
 * is more than a settings-tab grant should carry. Ruled 2026-08-20; recorded in
 * `SETTINGS_ROUTE_TABS` as `tab: null`.
 *
 * The service bounds the payload regardless of who is calling — the target must
 * be a real ERP interface brand, and every `legacyClaimCodes` entry must be a
 * claim brand whose ERP interface target *is* that target, both checked before
 * the first write. An admin should not be able to empty three applications'
 * department mappings by accident either. See
 * `src/lib/acc/department-map-guard.ts`.
 *
 * **This route edits the default (`FormCode NULL`), and says so out loud.**
 * Since migration 098 the table can hold a shared default plus one row per form
 * for the same department, but the แผนก tab has no form selector — it reads the
 * defaults (`getMultiBrandDepartmentMappingPage`) and so it must write them.
 * The `null` below is passed explicitly rather than left to a parameter default
 * or to the column's nullability, because it is the difference between saving
 * the shared mapping and rewriting some form's override, and that decision
 * belongs in the code rather than in whatever the callee happens to assume.
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
      // The default row. Not "no form" — the row every form resolves unless it
      // has one of its own.
      null,
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
