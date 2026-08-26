import type { BrandErpAccountConfig } from "@/lib/acc/erp-journal-builder";
import type { PpapJournalPayload } from "@/lib/acc/erp-ppap-payload";
import type { AdvanceDetail, AdvanceRequest } from "@/features/advance/types";

/**
 * Build the PPAP CreateFromJson payload for one advance.
 *
 * An advance is a single paired entry — Dr Vendor / Cr Bank — so the payload is
 * exactly two lines under one group (G1). The Dr G/L is derived by BC from the
 * vendor's posting group (ADV), so no G/L is configured here. Accounts come from
 * config (never hardcoded); a missing value throws a friendly error at send time.
 */
export function buildAdvanceJournalPayload(
  req: AdvanceRequest,
  advance: AdvanceDetail,
  config: BrandErpAccountConfig,
  departmentCode: string,
): PpapJournalPayload {
  const { bankAccountNo, journalBatchName, branchCode } = config;
  if (!bankAccountNo) throw new Error("ยังไม่ได้ตั้งค่า Bank Account สำหรับแบรนด์นี้");
  if (!journalBatchName) throw new Error("ยังไม่ได้ตั้งค่า Journal Batch สำหรับแบรนด์นี้");
  if (!req.paymentDate) throw new Error("ยังไม่กำหนดวันจ่าย (PaymentDate)");
  if (!advance.matchedVendorNo) throw new Error("ยังไม่ได้เลือก Vendor สำหรับรายการนี้ (แก้ที่ขั้น Accounting Officer)");

  // Post the THB base amount (foreign-currency advances convert via exchangeRate).
  const amount = advance.baseAmount ?? advance.amount ?? 0;
  const postingDate = req.paymentDate;
  // BC journal Description = the expense detail (รายละเอียดค่าใช้จ่าย); fall back to
  // request no + requester when blank. BC's Description caps at 100 chars.
  const description = (
    advance.purpose?.trim() || `เงินทดรองจ่าย ${req.requestNo ?? ""} ${req.requesterFullName ?? ""}`.trim()
  ).slice(0, 100);
  // The CU maps payload.employeeCode → BC "External Document No." (APJournalCreate.al,
  // CopyStr 1..35), so carry the request no (ADV26-xxxxx) there.
  const employeeCode = (req.requestNo ?? "").slice(0, 35);
  // departmentCode is already the resolved ERP dept (HR→ERP mapped or fixed) —
  // see resolveAdvanceErpDept in advance-erp-context.ts.
  // Branch falls back to the requester's ERP department when no brand-level
  // Branch is configured (AP-2-only rule; AP-1 requires a configured branch).
  // departmentCode always resolves (the context throws on an unmapped dept), so
  // the fallback never posts a blank branch.
  const branch = branchCode?.trim() || departmentCode;

  return {
    journalBatchName,
    lines: [
      {
        groupNo: "G1",
        postingDate,
        documentType: "Payment",
        accountType: "Vendor",
        accountNo: advance.matchedVendorNo,
        description,
        paymentMethodCode: "BANK",
        amount,
        employeeCode,
        branchCode: branch,
        departmentCode,
      },
      {
        groupNo: "G1",
        postingDate,
        documentType: "Payment",
        accountType: "Bank Account",
        accountNo: bankAccountNo,
        description,
        paymentMethodCode: "BANK",
        amount: -amount,
        employeeCode,
        branchCode: branch,
        departmentCode,
      },
    ],
  };
}

/**
 * Combine several advances into ONE Gen. Journal payload for a single BC post —
 * all lines share one group (G1), so BC assigns ONE document No. Series for the
 * whole batch (same "1 payload = 1 number" model as AP-1). Entries must belong
 * to one Company and share one Journal Batch.
 */
export function buildAdvanceBatchPayload(
  entries: { req: AdvanceRequest; advance: AdvanceDetail; config: BrandErpAccountConfig; departmentCode: string }[],
): PpapJournalPayload {
  if (entries.length === 0) throw new Error("ไม่มีรายการสำหรับส่ง");

  const batchNames = new Set(entries.map((e) => e.config.journalBatchName?.trim() || ""));
  if (batchNames.size > 1) {
    throw new Error("Journal Batch ของแบรนด์ในบริษัทนี้ไม่ตรงกัน — ตั้งให้เหมือนกันก่อนส่งรวม");
  }
  const journalBatchName = entries[0].config.journalBatchName;
  if (!journalBatchName) throw new Error("ยังไม่ได้ตั้งค่า Journal Batch");

  const lines: PpapJournalPayload["lines"] = [];
  for (const e of entries) {
    const single = buildAdvanceJournalPayload(e.req, e.advance, e.config, e.departmentCode);
    for (const line of single.lines) lines.push({ ...line, groupNo: "G1" });
  }
  return { journalBatchName, lines };
}
