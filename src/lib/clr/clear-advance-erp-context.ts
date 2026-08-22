import { loadAdvanceErpContext } from "@/lib/adv/advance-erp-context";
import { listClrInterfaceConfig } from "@/lib/clr/clear-advance-interface-config-service";
import type { ClrJournalConfig } from "@/lib/clr/clear-advance-erp-payload";
import type { AdvanceErpTarget } from "@/lib/adv/advance-erp-context";

export interface ClrErpContext {
  config: ClrJournalConfig;
  target: AdvanceErpTarget;
  departmentCode: string;
}

/**
 * Resolve the clearing-journal config + BC target for one AP-3 request's brand.
 * Advance GL / Bank / target Company / ERP dept are inherited from AP-2's config
 * (loadAdvanceErpContext). Journal Batch + VAT-input + WHT-payable come from AP-3's
 * own AccClearAdvanceInterfaceConfig.
 */
export async function loadClearAdvanceErpContext(
  brandCode: string,
  hrDeptCode?: string | null,
): Promise<ClrErpContext> {
  const code = brandCode.trim().toUpperCase();
  const [ap2, clrMap] = await Promise.all([
    loadAdvanceErpContext(code, hrDeptCode ?? null),
    listClrInterfaceConfig(),
  ]);
  const clr = clrMap[code] ?? { journalBatchName: null, vatInputGlAccountNo: null, whtPayableGlAccountNo: null };

  if (!ap2.config.glAccountNo) throw new Error(`ยังไม่ได้ตั้งค่า G/L เงินทดรองจ่าย (AP-2) สำหรับ ${code}`);
  if (!ap2.config.bankAccountNo) throw new Error(`ยังไม่ได้ตั้งค่า Bank Account (AP-2) สำหรับ ${code}`);
  if (!clr.journalBatchName) throw new Error(`ยังไม่ได้ตั้งค่า Journal Batch ของ AP-3 สำหรับ ${code}`);

  return {
    config: {
      advanceGlAccountNo: ap2.config.glAccountNo,
      bankAccountNo: ap2.config.bankAccountNo,
      vatInputGlAccountNo: clr.vatInputGlAccountNo,
      whtPayableGlAccountNo: clr.whtPayableGlAccountNo,
      journalBatchName: clr.journalBatchName,
    },
    target: ap2.target,
    departmentCode: ap2.erpDeptCode,
  };
}
