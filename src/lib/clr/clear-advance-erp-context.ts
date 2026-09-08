import { getAccPool, sql } from "@/lib/acc/pool";
import { loadAdvanceErpContext } from "@/lib/adv/advance-erp-context";
import { listClrInterfaceConfig } from "@/lib/clr/clear-advance-interface-config-service";
import type { ClrJournalConfig } from "@/lib/clr/clear-advance-erp-payload";
import type { AdvanceErpTarget } from "@/lib/adv/advance-erp-context";

export interface ClrErpContext {
  config: ClrJournalConfig;
  target: AdvanceErpTarget;
  departmentCode: string;
  branchCode: string | null;
}

/**
 * The confirmed vendor on the AP-2 this AP-3 clears.
 *
 * Only a `confirmed` match counts — the same bar AP-2's own send applies before
 * it posts the debit. A merely `suggested` vendor, or one reset by a later
 * re-match or a PayeeName edit, must not be credited here.
 *
 * Read live rather than copied onto the AP-3 row. That is still not a true
 * snapshot of what AP-2 posted: if the confirmed vendor is changed after the
 * advance was sent, this reads the new one. Snapshotting the posted vendor at
 * AP-2 send time is the proper fix and is tracked separately.
 */
async function resolveAdvanceVendorNo(advanceRequestId: number): Promise<string | null> {
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("rid", sql.Int, advanceRequestId)
    .query(`SELECT TOP 1 MatchedVendorNo FROM [dbo].[AccAdvance]
            WHERE RequestId = @rid AND VendorMatchStatus = 'confirmed'`);
  const raw = (res.recordset[0]?.MatchedVendorNo as string) ?? "";
  return raw.trim() || null;
}

/**
 * Resolve the clearing-journal config + BC target for one AP-3 request's brand.
 * Bank / target Company / ERP dept are inherited from AP-2's config
 * (loadAdvanceErpContext); the advance vendor is read from the linked AP-2 request.
 * Journal Batch + VAT-input + WHT-payable come from AP-3's own
 * AccClearAdvanceInterfaceConfig.
 */
export async function loadClearAdvanceErpContext(
  brandCode: string,
  hrDeptCode: string | null,
  advanceRequestId: number | null,
): Promise<ClrErpContext> {
  const code = brandCode.trim().toUpperCase();
  if (advanceRequestId == null) {
    throw new Error("ใบเคลียร์นี้ไม่ได้ผูกกับใบเบิก AP-2 — ส่ง ERP ไม่ได้");
  }
  const [ap2, clrMap, advanceVendorNo] = await Promise.all([
    loadAdvanceErpContext(code, hrDeptCode ?? null),
    listClrInterfaceConfig(),
    resolveAdvanceVendorNo(advanceRequestId),
  ]);
  const clr = clrMap[code] ?? { journalBatchName: null, vatInputGlAccountNo: null, whtPayableGlAccountNo: null };

  // No G/L fallback on purpose: AP-2 posts the debit to a vendor, so the
  // clearing credit must go to the same vendor or the vendor never clears.
  if (!advanceVendorNo) {
    throw new Error("ยังไม่ได้เลือก Vendor ในใบเบิก AP-2 ที่เคลียร์ใบนี้ — เปิดใบ AP-2 แล้วเลือก Vendor ก่อนส่ง");
  }
  if (!ap2.config.bankAccountNo) throw new Error(`ยังไม่ได้ตั้งค่า Bank Account (AP-2) สำหรับ ${code}`);
  if (!clr.journalBatchName) throw new Error(`ยังไม่ได้ตั้งค่า Journal Batch ของ AP-3 สำหรับ ${code}`);

  return {
    config: {
      advanceVendorNo,
      bankAccountNo: ap2.config.bankAccountNo,
      vatInputGlAccountNo: clr.vatInputGlAccountNo,
      whtPayableGlAccountNo: clr.whtPayableGlAccountNo,
      journalBatchName: clr.journalBatchName,
    },
    target: ap2.target,
    departmentCode: ap2.erpDeptCode,
    branchCode: ap2.config.branchCode ?? null,
  };
}
