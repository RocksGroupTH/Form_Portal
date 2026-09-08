import type { PpapJournalPayload, PpapJournalLinePayload } from "@/lib/acc/erp-ppap-payload";
import type { BranchLookupEntry } from "@/lib/erp/location-lookup-core";
import { PND_VENDOR_NO, type PndType } from "@/lib/clr/wht-pnd-core";

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
  description?: string | null;
  /** The tax invoice's own number — becomes `Tax Invoice No.` on its VAT line. */
  docNo?: string | null;
  /** The seller who issued it — becomes the VAT line's name and VAT registration. */
  taxId?: string | null;
  payeeName?: string | null;
  /** The seller's branch, five digits — becomes `Branch Code` on the VAT line. */
  taxBranchCode?: string | null;
  /** The date printed on this line's receipt — decides the Z-ADJ marker (§4.1). */
  expenseDate?: string | null;
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
  /** The AP-2 number being cleared — the number accounting reconciles against. */
  advanceRequestNo?: string | null;
  /** Full name of the person clearing, for the line description. */
  requesterName?: string | null;
  /**
   * The requester's HR staff id. Goes to BC as External Document No. — the
   * interface layout's row 25 says รหัสพนักงาน and the requirements say *only*
   * that (`ap3-clear-advance-specification.md` §4). Null when the request has no
   * staff id, which sends the field empty rather than substituting a value that
   * means something else.
   */
  staffId?: number | null;
  /**
   * Branch → the BU its Location is bound to, loaded once per clearing by
   * `loadBranchLookup`. Absent — the state before the Location sync has ever
   * run — every line sends no `buCode` and the codeunit's COCO applies, exactly
   * as before this existed.
   */
  branchBu?: ReadonlyMap<string, BranchLookupEntry>;
  /**
   * The WHT payees on this clearing, each with the ภ.ง.ด. type somebody decided
   * (spec §5.3a). Only the type is read here: the amounts go to BC as 0 and the
   * payee's identity lives on the certificate, not the journal.
   */
  whtPayees?: readonly { pndType?: PndType | null }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Constant on every AP-3 VAT line (sheet row 8; VATHO confirmed by the user,
 * 2026-09-08). Standard Gen. Journal Line fields — no dependency needed.
 */
const VAT_GEN_POSTING_TYPE = "Purchase";
const VAT_BUS_POSTING_GROUP = "VATHO";
const VAT_PROD_POSTING_GROUP = "FVAT";

/** BC field widths, cut here rather than rejected there. */
const TAX_INVOICE_NO_MAX = 35;
const TAX_INVOICE_NAME_MAX = 250;

/** Trimmed to `max`, or undefined when there is nothing to send. */
function taxText(v: string | null | undefined, max: number): string | undefined {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : undefined;
}

/** The Z-ADJ dimension value for a prior-period adjustment (spec §4.1). The
 *  requirements call it "MS"; the value that exists in BC is `M-ADJ`. */
export const PRIOR_PERIOD_ADJ_CODE = "M-ADJ";

/**
 * Is this receipt from an accounting month earlier than the one it is posting
 * into?
 *
 * Compared as `YYYY-MM` text, which handles the year boundary without date
 * arithmetic: "2025-12" < "2026-01" sorts correctly as a string. Either date
 * missing answers false — the rule needs a date to be true, and an absent one
 * makes it unknown rather than false, which comes to the same thing here: no
 * marker, rather than a marker derived from a date nobody has.
 */
export function isPriorPeriod(expenseDate: string | null | undefined, postingDate: string): boolean {
  const a = (expenseDate ?? "").slice(0, 7);
  const b = (postingDate ?? "").slice(0, 7);
  if (a.length !== 7 || b.length !== 7) return false;
  return a < b;
}

/**
 * Build the PPAP CreateFromJson payload for ONE AP-3 clearing.
 * Dr expenses (per item) + Dr VAT input + WHT payable (0) + advance Vendor (0) +/- Bank diff.
 * Line amount sign: >0 = debit, <0 = credit.
 *
 * The lines do NOT sum to 0. Spec §3.2 requires the WHT and clear-advance vendor lines
 * to carry 0 so accounting matches and clears them by hand in BC; CU 50263 only inserts
 * (never posts), and BC enforces balance at posting time, so an unbalanced batch is fine.
 */
export function buildClearAdvanceJournalPayload(input: ClrJournalInput): PpapJournalPayload {
  const { config: c, items, requestNo, postingDate, departmentCode } = input;
  const advanceVendorNo = c.advanceVendorNo?.trim() ?? "";
  if (!advanceVendorNo) throw new Error("ยังไม่ได้เลือก Vendor ในใบเบิก AP-2 ที่เคลียร์ใบนี้ — เปิดใบ AP-2 แล้วเลือก Vendor ก่อนส่ง");
  if (!c.bankAccountNo) throw new Error("ยังไม่ได้ตั้งค่า Bank Account (จาก AP-2) สำหรับแบรนด์นี้");
  if (!c.journalBatchName) throw new Error("ยังไม่ได้ตั้งค่า Journal Batch ของ AP-3 สำหรับแบรนด์นี้");
  if (items.length === 0) throw new Error("ไม่มีรายการค่าใช้จ่ายสำหรับสร้าง journal");

  // → BC "External Document No." (APJournalCreate.al:214). This used to carry
  // `requestNo`, which is why it read as done until someone looked at the value:
  // ADC26-09008 reached BC as "ADC26-09008" where the layout asks for the
  // requester's staff id.
  const employeeCode = input.staffId != null ? String(input.staffId).slice(0, 35) : "";
  const defaultBranch = input.defaultBranchCode ?? "";

  /**
   * The BU for a line's branch, or undefined when there is no answer — either
   * no Location for that branch, or a Location carrying no BU. Both send
   * nothing: absence is what makes the codeunit apply its own COCO, where an
   * explicit "COCO" would be indistinguishable from a real answer.
   *
   * Upper-cased on the way in. The branch arrives from a picker and the map from
   * BC, and a case mismatch would resolve to nothing and land back on COCO —
   * silently reinstating the bug this replaces.
   */
  const resolveBu = (branchCode: string | null): string | undefined => {
    const key = (branchCode ?? defaultBranch).trim().toUpperCase();
    if (!key) return undefined;
    return input.branchBu?.get(key)?.buCode ?? undefined;
  };
  // Spec §3.2 format: [ADV no] เบิก เคลียร์เงินทดลอง [employee] [document detail].
  // Gen. Journal Line Description is 100 chars, so the trailing detail is what gets
  // cut — the identifying half has to survive.
  const advNo = (input.advanceRequestNo ?? "").trim() || requestNo;
  const who = (input.requesterName ?? "").trim();
  const describe = (detail?: string | null) =>
    [advNo, "เบิก", "เคลียร์เงินทดลอง", who, (detail ?? "").trim()]
      .filter((s) => s !== "")
      .join(" ")
      .slice(0, 100);

  const actualNet = r2(items.reduce((s, it) => s + it.amountBeforeVat + (it.vatAmount || 0) - (it.whtAmount || 0), 0));
  const bankAmount = r2(input.advanceAmount - actualNet);
  /**
   * Always `Refund` (user, 2026-09-08). It describes the whole clearing, so every
   * line carries the same value.
   *
   * This is a deliberate divergence from `ap3-clear-advance-specification.md`
   * row 76, which asks for `Payment` when the company pays the employee more than
   * they drew. Two consequences, recorded rather than hidden:
   *
   * The direction of the money is still on the bank line, which keeps its own
   * sign — so a pay-extra clearing goes out as a `Refund` document carrying a
   * credit bank line. Row 77 pairs Refund with a debit bank line, and that
   * pairing no longer holds.
   *
   * The exactly-equal case used to fall through to `Payment`, which matched
   * neither rule and read as a payment where nothing was paid. That one is
   * simply fixed.
   */
  const documentType = "Refund";

  const glLine = (
    accountNo: string,
    amount: number,
    branchCode: string | null,
    detail?: string | null,
    adjCode?: string,
  ): PpapJournalLinePayload => ({
    groupNo: "G1", postingDate, documentType, accountType: "G/L Account",
    accountNo, description: describe(detail),
    paymentMethodCode: "BANK", amount: r2(amount), balAccountType: "G/L Account",
    employeeCode, branchCode: branchCode ?? defaultBranch, departmentCode,
    // Spread rather than `adjCode: undefined`, so an unmarked line serialises
    // byte-for-byte as it did before this feature existed. Same for buCode.
    ...(adjCode ? { adjCode } : null),
    ...(resolveBu(branchCode) ? { buCode: resolveBu(branchCode) } : null),
  });

  const lines: PpapJournalLinePayload[] = [];
  let whtTotal = 0;

  for (const it of items) {
    const adj = isPriorPeriod(it.expenseDate, postingDate) ? PRIOR_PERIOD_ADJ_CODE : undefined;

    if (r2(it.amountBeforeVat) !== 0) {
      lines.push(glLine(it.glAccountNo, it.amountBeforeVat, it.branchCode, it.description, adj));
    }

    // One VAT line per invoice, immediately after its own expense line.
    //
    // It used to be a single line carrying the sum of every item's VAT. Tax
    // Invoice No., Date, Base and Name (spec §5.4) each belong to one specific
    // invoice, and a summed line has no honest value to put in them — so the
    // split comes first and the keys go on afterwards.
    //
    // The line takes its item's own branch, and its BU and Z-ADJ marker with it:
    // the VAT on a prior-period receipt is part of that same adjustment, and
    // belongs to the same branch as the expense it was charged on.
    const vat = r2(it.vatAmount || 0);
    if (vat > 0) {
      if (!c.vatInputGlAccountNo) throw new Error("มี VAT แต่ยังไม่ได้ตั้งค่าบัญชีภาษีซื้อ (VAT input) ของแบรนด์นี้");
      const invoiceNo = taxText(it.docNo, TAX_INVOICE_NO_MAX);
      const sellerName = taxText(it.payeeName, TAX_INVOICE_NAME_MAX);
      const sellerTaxId = taxText(it.taxId, 20);
      const invoiceDate = (it.expenseDate ?? "").trim() || undefined;
      lines.push({
        ...glLine(c.vatInputGlAccountNo, vat, it.branchCode, it.description, adj),
        // The tax block belongs to the VAT line and to no other: a posting group
        // on an expense, vendor or bank line changes how BC treats it.
        genPostingType: VAT_GEN_POSTING_TYPE,
        vatBusPostingGroup: VAT_BUS_POSTING_GROUP,
        vatProdPostingGroup: VAT_PROD_POSTING_GROUP,
        // Spread individually: a receipt whose seller nobody filled in sends no
        // seller keys, so BC keeps whatever is in those fields rather than
        // having them overwritten with blanks.
        ...(invoiceNo ? { taxInvoiceNo: invoiceNo } : null),
        ...(invoiceDate ? { taxInvoiceDate: invoiceDate } : null),
        // The base is what VAT was charged on, not the VAT itself.
        taxInvoiceBase: r2(it.amountBeforeVat),
        ...(sellerName ? { taxInvoiceName: sellerName } : null),
        ...(sellerTaxId ? { taxVatRegistrationNo: sellerTaxId } : null),
        // Left out when unknown so BC keeps the vendor card's own branch,
        // rather than being handed a blank for a tax filing.
        ...(taxText(it.taxBranchCode, 5) ? { taxBranchCode: taxText(it.taxBranchCode, 5) } : null),
      });
    }

    whtTotal += it.whtAmount || 0;
  }
  whtTotal = r2(whtTotal);
  if (whtTotal > 0) {
    // Spec §5.3: a Vendor line at WHT-PND.3 / WHT-PND.53, not a G/L line at the
    // configured WHT-payable account. Accounting clears these against the
    // vendor, so the vendor has to be what the line points at.
    const payees = input.whtPayees ?? [];
    if (payees.length === 0) {
      throw new Error(
        "มีภาษีหัก ณ ที่จ่ายแต่ไม่มีรายการผู้รับเงิน — เพิ่มผู้รับเงินและระบุประเภท ภ.ง.ด. ก่อนส่ง",
      );
    }
    if (payees.some((w) => !w.pndType)) {
      // Refusing beats guessing. A vendor picked here lands in accounting's
      // ledger under their name, on a line carrying 0 that is easy to miss.
      throw new Error(
        "ยังไม่ได้ระบุประเภท ภ.ง.ด. ของผู้รับเงินบางราย — ระบุที่ขั้นบัญชีก่อนส่ง",
      );
    }
    // One line per distinct type, not per payee: every amount is 0, so a line's
    // only content is which vendor account has to be cleared, and two payees of
    // one type would repeat that with nothing added.
    const types: PndType[] = [];
    for (const w of payees) {
      const t = w.pndType as PndType;
      if (!types.includes(t)) types.push(t);
    }
    for (const t of types) {
      // Built inline rather than via glLine: a Vendor line carries no
      // balAccountType — the two-explicit-lines shape BC accepted for AP-2.
      lines.push({
        groupNo: "G1", postingDate, documentType,
        accountType: "Vendor", accountNo: PND_VENDOR_NO[t],
        description: describe(),
        // Spec §3.2: sent as 0 — accounting posts the real WHT by hand in BC.
        paymentMethodCode: "BANK", amount: 0,
        employeeCode, branchCode: defaultBranch, departmentCode,
        ...(resolveBu(null) ? { buCode: resolveBu(null) } : null),
      });
    }
  }

  // The vendor AP-2 debited. Built inline rather than via glLine because the
  // vendor line must carry accountType "Vendor" and NO balAccountType — the
  // two-explicit-lines shape BC accepted for AP-2 (doc PVA2608-0012).
  // Spec §3.2: the clear-advance vendor line is always 0 too. The line still has to
  // be here, pointing at the vendor AP-2 debited, so accounting can match it.
  lines.push({
    groupNo: "G1", postingDate, documentType,
    accountType: "Vendor", accountNo: advanceVendorNo,
    description: describe(),
    paymentMethodCode: "BANK", amount: 0,
    employeeCode, branchCode: defaultBranch, departmentCode,
    ...(resolveBu(null) ? { buCode: resolveBu(null) } : null),
  });

  if (bankAmount !== 0) {
    lines.push({
      groupNo: "G1", postingDate, documentType, accountType: "Bank Account",
      accountNo: c.bankAccountNo, description: describe(),
      paymentMethodCode: "BANK", amount: bankAmount,
      employeeCode, branchCode: defaultBranch, departmentCode,
      ...(resolveBu(null) ? { buCode: resolveBu(null) } : null),
    });
  }

  return { journalBatchName: c.journalBatchName.trim(), lines };
}
