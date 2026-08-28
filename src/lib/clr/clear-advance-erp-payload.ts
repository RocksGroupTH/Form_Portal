import type { PpapJournalPayload, PpapJournalLinePayload } from "@/lib/acc/erp-ppap-payload";

export interface ClrJournalConfig {
  /** The vendor AP-2 debited — this clearing credits the same one. */
  advanceVendorNo: string;
  bankAccountNo: string;
  vatInputGlAccountNo: string | null;
  whtPayableGlAccountNo: string | null;
  journalBatchName: string;
}
export interface ClrJournalItem {
  glAccountNo: string;
  amountBeforeVat: number;
  vatAmount: number;
  whtAmount: number;
  branchCode: string | null;
}
export interface ClrJournalInput {
  requestNo: string;
  postingDate: string;
  advanceAmount: number;
  items: ClrJournalItem[];
  config: ClrJournalConfig;
  departmentCode: string;
  /** Fallback branch for lines that have no per-item branch (VAT, WHT, advance reversal, bank diff). */
  defaultBranchCode?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the PPAP CreateFromJson payload for ONE AP-3 clearing.
 * Dr expenses (per item) + Dr VAT input - Cr WHT payable - Cr advance Vendor +/- Bank diff.
 * Line amount sign: >0 = debit, <0 = credit; the lines always sum to 0.
 */
export function buildClearAdvanceJournalPayload(input: ClrJournalInput): PpapJournalPayload {
  const { config: c, items, requestNo, postingDate, departmentCode } = input;
  if (!c.advanceVendorNo) throw new Error("ยังไม่ได้เลือก Vendor ในใบเบิก AP-2 ที่เคลียร์ใบนี้ — เปิดใบ AP-2 แล้วเลือก Vendor ก่อนส่ง");
  if (!c.bankAccountNo) throw new Error("ยังไม่ได้ตั้งค่า Bank Account (จาก AP-2) สำหรับแบรนด์นี้");
  if (!c.journalBatchName) throw new Error("ยังไม่ได้ตั้งค่า Journal Batch ของ AP-3 สำหรับแบรนด์นี้");
  if (items.length === 0) throw new Error("ไม่มีรายการค่าใช้จ่ายสำหรับสร้าง journal");

  const employeeCode = requestNo.slice(0, 35);
  const defaultBranch = input.defaultBranchCode ?? "";
  const glLine = (accountNo: string, amount: number, branchCode: string | null): PpapJournalLinePayload => ({
    groupNo: "G1", postingDate, documentType: "Payment", accountType: "G/L Account",
    accountNo, description: `เคลียร์เงินทดรองจ่าย ${requestNo}`.slice(0, 100),
    paymentMethodCode: "BANK", amount: r2(amount), balAccountType: "G/L Account",
    employeeCode, branchCode: branchCode ?? defaultBranch, departmentCode,
  });

  const lines: PpapJournalLinePayload[] = [];
  let vatTotal = 0, whtTotal = 0;

  for (const it of items) {
    if (r2(it.amountBeforeVat) !== 0) lines.push(glLine(it.glAccountNo, it.amountBeforeVat, it.branchCode));
    vatTotal += it.vatAmount || 0;
    whtTotal += it.whtAmount || 0;
  }
  vatTotal = r2(vatTotal); whtTotal = r2(whtTotal);

  if (vatTotal > 0) {
    if (!c.vatInputGlAccountNo) throw new Error("มี VAT แต่ยังไม่ได้ตั้งค่าบัญชีภาษีซื้อ (VAT input) ของแบรนด์นี้");
    lines.push(glLine(c.vatInputGlAccountNo, vatTotal, null));
  }
  if (whtTotal > 0) {
    if (!c.whtPayableGlAccountNo) throw new Error("มี WHT แต่ยังไม่ได้ตั้งค่าบัญชี WHT payable ของแบรนด์นี้");
    lines.push(glLine(c.whtPayableGlAccountNo, -whtTotal, null));
  }

  // Cr the vendor AP-2 debited. Built inline rather than via glLine because the
  // vendor line must carry accountType "Vendor" and NO balAccountType — the
  // two-explicit-lines shape BC accepted for AP-2 (doc PVA2608-0012).
  lines.push({
    groupNo: "G1", postingDate, documentType: "Payment",
    accountType: "Vendor", accountNo: c.advanceVendorNo,
    description: `เคลียร์เงินทดรองจ่าย ${requestNo}`.slice(0, 100),
    paymentMethodCode: "BANK", amount: -r2(input.advanceAmount),
    employeeCode, branchCode: defaultBranch, departmentCode,
  });

  const actualNet = r2(items.reduce((s, it) => s + it.amountBeforeVat + (it.vatAmount || 0) - (it.whtAmount || 0), 0));
  const bankAmount = r2(input.advanceAmount - actualNet);
  if (bankAmount !== 0) {
    lines.push({
      groupNo: "G1", postingDate, documentType: "Payment", accountType: "Bank Account",
      accountNo: c.bankAccountNo, description: `เคลียร์เงินทดรองจ่าย ${requestNo}`.slice(0, 100),
      paymentMethodCode: "BANK", amount: bankAmount,
      employeeCode, branchCode: defaultBranch, departmentCode,
    });
  }

  return { journalBatchName: c.journalBatchName.trim(), lines };
}
