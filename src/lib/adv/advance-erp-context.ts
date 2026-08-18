import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { listBrandAccounts } from "@/lib/acc/brand-account-service";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
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
  /** G/L (AP-2 per-form), Bank + Journal Batch + Branch (per-brand, shared). */
  config: BrandErpAccountConfig;
  target: AdvanceErpTarget;
}

/**
 * Resolve the ERP journal config + BC target for one brand's advance.
 *
 * Bank / Journal Batch / Branch reuse AP-1's per-brand resolution
 * (`loadErpJournalBuildContext`); only the G/L account is swapped for the
 * AP-2 per-form config (`AccBrandGlAccount` filtered on FormCode='AP-2').
 */
export async function loadAdvanceErpContext(brandCode: string): Promise<AdvanceErpContext> {
  const code = brandCode.trim().toUpperCase();
  const ctx = await loadErpJournalBuildContext();
  const base = ctx.brandAccounts[code];

  const glRows = await listBrandAccounts("gl", brandCode, AP2_FORM_CODE);
  const gl = glRows.find((r) => r.isActive) ?? glRows[0];

  const config: BrandErpAccountConfig = {
    glAccountNo: gl?.accountNo?.trim() ?? null,
    erpDescription: gl?.erpDescription?.trim() ?? gl?.displayName?.trim() ?? null,
    bankAccountNo: base?.bankAccountNo ?? null,
    branchCode: base?.branchCode ?? null,
    journalBatchName: base?.journalBatchName ?? null,
    deptAsBranch: base?.deptAsBranch ?? false,
    fixedErpDeptCode: base?.fixedErpDeptCode ?? null,
  };

  const interfaceTarget = (ctx.interfaceByClaim[code] ?? code).toUpperCase();
  const profile = await resolveErpTargetProfile(interfaceTarget);
  if (!profile?.profileComplete || !profile.bcConnectionId || !profile.bcId || !profile.baseUrl) {
    throw new Error(
      `การตั้งค่า BC สำหรับ ${interfaceTarget} ยังไม่ครบ — ตรวจสอบที่ Settings → Interface ERP`,
    );
  }

  return {
    config,
    target: {
      interfaceTarget,
      bcConnectionId: profile.bcConnectionId,
      bcId: profile.bcId,
      baseUrl: profile.baseUrl,
      environment: profile.environment,
    },
  };
}
