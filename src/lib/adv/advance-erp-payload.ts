import type { BrandErpAccountConfig } from "@/lib/acc/erp-journal-builder";
import type { PpapJournalPayload } from "@/lib/acc/erp-ppap-payload";
import type { AdvanceDetail, AdvanceRequest } from "@/features/advance/types";

/**
 * Build the PPAP CreateFromJson payload for one advance.
 *
 * An advance is a single paired entry — Dr เงินทดรองจ่าย (G/L) / Cr Bank — so the
 * payload is exactly two lines under one group (G1). Accounts come from config
 * (never hardcoded); a missing value throws a friendly error at send time.
 */
export function buildAdvanceJournalPayload(
  req: AdvanceRequest,
  advance: AdvanceDetail,
  config: BrandErpAccountConfig,
  departmentCode: string,
): PpapJournalPayload {
  const { glAccountNo, bankAccountNo, journalBatchName, branchCode } = config;
  if (!glAccountNo) throw new Error("ยังไม่ได้ตั้งค่า G/L Account ของ AP-2 สำหรับแบรนด์นี้ (Settings → บัญชี AP-2)");
  if (!bankAccountNo) throw new Error("ยังไม่ได้ตั้งค่า Bank Account สำหรับแบรนด์นี้");
  if (!journalBatchName) throw new Error("ยังไม่ได้ตั้งค่า Journal Batch สำหรับแบรนด์นี้");
  if (!req.paymentDate) throw new Error("ยังไม่กำหนดวันจ่าย (PaymentDate)");

  // Post the THB base amount (foreign-currency advances convert via exchangeRate).
  const amount = advance.baseAmount ?? advance.amount ?? 0;
  const postingDate = req.paymentDate;
  const description = `เงินทดรองจ่าย ${req.requestNo ?? ""} ${req.requesterFullName ?? ""}`.trim();
  const employeeCode = req.staffId != null ? String(req.staffId) : "";
  const branch = branchCode ?? "";

  return {
    journalBatchName,
    lines: [
      {
        groupNo: "G1",
        postingDate,
        documentType: "Payment",
        accountType: "G/L Account",
        accountNo: glAccountNo,
        description,
        paymentMethodCode: "BANK",
        amount,
        balAccountType: "G/L Account",
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
