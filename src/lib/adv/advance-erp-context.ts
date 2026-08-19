import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { loadDepartmentErpMapsByTarget } from "@/lib/acc/department-map-service";
import { getAdvanceInterfaceConfig } from "@/lib/adv/advance-interface-config-service";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import type { BrandErpAccountConfig } from "@/lib/acc/erp-journal-builder";

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

/**
 * The ERP department dimension for the journal, matching AP-1:
 *  - a brand with Fix Dept (deptAsBranch + fixedErpDeptCode) uses the fixed code;
 *  - otherwise the requester's HR department is translated to its ERP code via
 *    the Department map (Accounting → Interface ERP → แผนก). Unmapped → throws,
 *    so the preview flags it and the send is blocked (never posts a bad dept).
 */
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
 * AP-2 has its OWN interface config (AccAdvanceInterfaceConfig): G/L, Bank, Branch
 * and Journal Batch. Each falls back to AP-1's shared per-brand config
 * (`loadErpJournalBuildContext`) when AP-2 hasn't set its own. The target Company
 * is inherited from AP-1's brand→Company mapping.
 */
export async function loadAdvanceErpContext(
  brandCode: string,
  hrDeptCode?: string | null,
): Promise<AdvanceErpContext> {
  const code = brandCode.trim().toUpperCase();
  const [ctx, cfg] = await Promise.all([
    loadErpJournalBuildContext(),
    getAdvanceInterfaceConfig(code),
  ]);
  const base = ctx.brandAccounts[code];

  const config: BrandErpAccountConfig = {
    glAccountNo: cfg?.glAccountNo ?? base?.glAccountNo ?? null,
    erpDescription: cfg?.glErpDescription ?? base?.erpDescription ?? null,
    bankAccountNo: cfg?.bankAccountNo ?? base?.bankAccountNo ?? null,
    branchCode: cfg?.branchCode ?? base?.branchCode ?? null,
    journalBatchName: cfg?.journalBatchName ?? base?.journalBatchName ?? null,
    deptAsBranch: base?.deptAsBranch ?? false,
    fixedErpDeptCode: base?.fixedErpDeptCode ?? null,
  };

  // AP-2's own target (Company) → falls back to AP-1's brand→Company mapping.
  const interfaceTarget = (cfg?.interfaceBrandCode ?? ctx.interfaceByClaim[code] ?? code).toUpperCase();
  const profile = await resolveErpTargetProfile(interfaceTarget);
  if (!profile?.profileComplete || !profile.bcConnectionId || !profile.bcId || !profile.baseUrl) {
    throw new Error(
      `การตั้งค่า BC สำหรับ ${interfaceTarget} ยังไม่ครบ — ตรวจสอบที่ Settings → Interface ERP`,
    );
  }

  const erpDeptCode = await resolveAdvanceErpDept(config, interfaceTarget, ctx.interfaceByClaim, hrDeptCode ?? null);

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
