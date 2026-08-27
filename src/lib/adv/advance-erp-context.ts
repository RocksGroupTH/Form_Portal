import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { loadDepartmentErpMapsByTarget } from "@/lib/acc/department-map-service";
import { listBrandAccounts } from "@/lib/acc/brand-account-service";
import { listBrandBranches } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches } from "@/lib/acc/brand-journal-batch-service";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import type { BrandErpAccountConfig } from "@/lib/acc/erp-journal-builder";
import { AP2_FORM_CODE } from "@/features/advance/constants";

export interface AdvanceErpTarget {
  interfaceTarget: string;
  bcConnectionId: number;
  bcId: string;
  baseUrl: string;
  environment: ErpBcEnvironment;
}

export interface AdvanceErpContext {
  config: BrandErpAccountConfig;
  target: AdvanceErpTarget;
  /** ERP department code for the journal — HR dept mapped to ERP (or fixed dept). */
  erpDeptCode: string;
}

async function resolveAdvanceErpDept(
  config: BrandErpAccountConfig,
  interfaceTarget: string,
  interfaceByClaim: Record<string, string>,
  hrDeptCode: string | null,
): Promise<string> {
  const fixed = config.fixedErpDeptCode?.trim();
  if (config.deptAsBranch && fixed) return fixed;

  const hr = (hrDeptCode ?? "").trim();
  const deptMaps = await loadDepartmentErpMapsByTarget(new Map(Object.entries(interfaceByClaim)));
  const mapped = hr ? deptMaps.get(interfaceTarget)?.get(hr) ?? null : null;
  if (!mapped) {
    throw new Error(
      `ยังไม่ได้ map แผนก${hr ? ` "${hr}"` : "ของผู้ขอ"} เป็น Department ของ ERP (${interfaceTarget}) — ` +
      `ตั้งค่าที่ Accounting → Interface ERP → แผนก (HR ↔ ERP)`,
    );
  }
  return mapped;
}

/**
 * Resolve the ERP journal config + BC target for one brand's advance.
 *
 * Reads GL/Bank/Branch/Batch from the shared per-form tables (FormCode='AP-2').
 * Falls back to the NULL-default rows (AP-1's shared config) for brands that
 * have no AP-2-specific override. The target Company comes from
 * loadErpJournalBuildContext's interfaceByClaim map, which already resolves
 * the AP-2 override (AccBrandErpInterface FormCode='AP-2') before the NULL default.
 */
/**
 * Resolve a portal brand (claim) to the BC interface Company code that keys
 * ErpVendors and the other Rocks_ERP_Data masters (e.g. ROCKS → PCTH). Idempotent
 * for values that are already interface Company codes (PCTH → PCTH). Vendor
 * lookups must use this, never the raw brand, or they query a non-existent
 * BrandCode and come back empty.
 */
export async function resolveAdvanceInterfaceCompany(brandCode: string): Promise<string> {
  const code = (brandCode ?? "").trim().toUpperCase();
  if (!code) return "";
  const ctx = await loadErpJournalBuildContext(AP2_FORM_CODE);
  return (ctx.interfaceByClaim[code] ?? code).toUpperCase();
}

export async function loadAdvanceErpContext(
  brandCode: string,
  hrDeptCode?: string | null,
): Promise<AdvanceErpContext> {
  const code = brandCode.trim().toUpperCase();

  const [ctx, glRows, bankRows, branchRows, batchRows] = await Promise.all([
    loadErpJournalBuildContext(AP2_FORM_CODE),
    listBrandAccounts("gl",   code, AP2_FORM_CODE),
    listBrandAccounts("bank", code, AP2_FORM_CODE),
    listBrandBranches(code, AP2_FORM_CODE),
    listBrandJournalBatches(code, AP2_FORM_CODE),
  ]);

  // Prefer FormCode='AP-2' rows; fall back to the picked NULL-default row.
  const gl     = glRows.find(r => r.formCode === AP2_FORM_CODE)     ?? glRows[0]     ?? null;
  const bank   = bankRows.find(r => r.formCode === AP2_FORM_CODE)   ?? bankRows[0]   ?? null;
  const batch  = batchRows.find(r => r.formCode === AP2_FORM_CODE)  ?? batchRows[0]  ?? null;
  // Branch is the exception: AP-2 self-owns it. Only an explicit AP-2 row counts —
  // an inherited NULL-default (AP-1's shared branch, e.g. HQ) is treated as "no
  // branch" so a blank AP-2 branch falls back to the requester's mapped ERP dept.
  const branch = branchRows.find(r => r.formCode === AP2_FORM_CODE) ?? null;

  const config: BrandErpAccountConfig = {
    glAccountNo:       gl?.accountNo?.trim()       ?? null,
    erpDescription:    gl?.erpDescription?.trim()  ?? null,
    bankAccountNo:     bank?.accountNo?.trim()     ?? null,
    branchCode:        branch?.branchCode?.trim()  ?? null,
    journalBatchName:  batch?.batchName?.trim()    ?? null,
    deptAsBranch:      branch?.deptAsBranch ?? false,
    fixedErpDeptCode:  branch?.fixedErpDeptCode?.trim() ?? null,
  };

  const interfaceTarget = (ctx.interfaceByClaim[code] ?? code).toUpperCase();
  const profile = await resolveErpTargetProfile(interfaceTarget, AP2_FORM_CODE);
  if (!profile?.profileComplete || !profile.bcConnectionId || !profile.bcId || !profile.baseUrl) {
    throw new Error(
      `การตั้งค่า BC สำหรับ ${interfaceTarget} ยังไม่ครบ — ตรวจสอบที่ Settings → Interface ERP`,
    );
  }

  const erpDeptCode = await resolveAdvanceErpDept(
    config, interfaceTarget, ctx.interfaceByClaim, hrDeptCode ?? null,
  );

  return {
    config,
    erpDeptCode,
    target: {
      interfaceTarget,
      bcConnectionId: profile.bcConnectionId,
      bcId: profile.bcId,
      baseUrl: profile.baseUrl,
      environment: profile.environment,
    },
  };
}
