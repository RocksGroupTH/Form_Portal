import type { PpapJournalPayload, PpapJournalLinePayload } from "@/lib/acc/erp-ppap-payload";
import type { BranchLookupEntry } from "@/lib/erp/location-lookup-core";
import { PRIOR_PERIOD_ADJ_CODE, isPriorPeriod } from "@/lib/clr/clear-advance-erp-payload";

/**
 * AP-4 — the Business Central journal for one staff reimbursement.
 *
 * ```
 * Dr expense (per line)  +  Dr VAT input (per invoice)
 *   − Cr withholding payable  − Cr bank
 * ```
 *
 * Pure: plain values in, `PpapJournalPayload` out. Nothing here opens a pool,
 * so every rule below is unit-tested with an array — the same split
 * `clear-advance-erp-payload.ts` uses, and `./reimburse-erp-context.ts` is the
 * IO half that feeds it.
 *
 * ## Read against AP-3's, because it is nearly the same journal and the
 * ## differences are all deliberate
 *
 * - **These lines sum to zero. AP-3's do not.** AP-3 sends its withholding and
 *   its advance-vendor lines at **0** so accounting matches and clears them by
 *   hand in BC, and CU 50263 only inserts, so an unbalanced batch is fine
 *   there. AP-4 has nothing to clear by hand: every line carries its real
 *   amount. A reader who "completes the copy" by zeroing the withholding line
 *   turns real tax into nothing.
 * - **Withholding is a G/L line, not a Vendor line.** AP-3 posts to
 *   `WHT-PND.3` / `WHT-PND.53` and refuses to build at all when the ภ.ง.ด. type
 *   is missing. AP-4 collects no ภ.ง.ด. type and has no payee list, so that
 *   rule would make every claim with withholding unsendable. It posts to the
 *   brand's configured WHT-payable account instead — decided by the user,
 *   2026-09-14.
 * - **`documentType` is always `Payment`.** AP-3 chooses between Refund and
 *   Payment from the sign of its bank difference, because an advance can come
 *   back. A reimbursement only ever pays out.
 * - **The credit is the bank**, not a vendor. AP-2 debits an employee's
 *   subledger and AP-3 credits it back; AP-4 has no advance in between, so the
 *   money simply leaves the configured account.
 * - **The posting date is the payment date accounting set.** AP-3 chooses
 *   between the refund slip's date and the payment run; AP-4 has only the run.
 *
 * Everything else — the per-invoice VAT line and its tax block, the Z-ADJ
 * marker on a prior-period receipt, the branch-then-BU redirect on the expense
 * line alone, `employeeCode` as the requester's staff id — is AP-3's, and is
 * *shared by import* where the rule is more than a constant (`isPriorPeriod`).
 */

export interface ReimburseJournalConfig {
  /** Where the money leaves from — `AccBrandBankAccount`, AP-4's own row or the shared default. */
  bankAccountNo: string;
  /** Input tax. Null is only an error on a claim that actually has VAT. */
  vatInputGlAccountNo: string | null;
  /** Withholding payable. Null is only an error on a claim that actually withholds. */
  whtPayableGlAccountNo: string | null;
  /**
   * **AP-4's own batch**, resolved by the context from
   * `listBrandJournalBatches(claimBrand, "AP-4")` — never through
   * `ctx.brandAccounts`, whose `resolveJournalBatchName` looks a claim brand up
   * by its INTERFACE brand first and so lets a target-keyed row beat AP-4's
   * override. That is the AP-2 failure this repository has already shipped
   * once: the screen displayed one batch while the payload sent another.
   */
  journalBatchName: string;
}

export interface ReimburseJournalItem {
  /** The line's coded expense account — `AccReimburseItem.Category`. */
  glAccountNo: string;
  amountBeforeVat: number;
  vatAmount: number;
  whtAmount: number;
  /** สาขาที่ใช้จ่าย — OURS. Migration 149. */
  branchCode: string | null;
  description?: string | null;
  /** The tax invoice's own number — becomes `Tax Invoice No.` on its VAT line. */
  docNo?: string | null;
  /** The seller's tax id — becomes the VAT line's VAT registration. */
  taxId?: string | null;
  /** The seller as printed — becomes `Tax Invoice Name`. */
  payeeName?: string | null;
  /** สาขาผู้ขาย — THEIRS, five digits, the RD's numbering. Migration 149. */
  taxBranchCode?: string | null;
  /** The seller's BC vendor card — `AccReimburseItem.VendorNo`. Often absent, legitimately. */
  taxVendorNo?: string | null;
  /** The date on this line's receipt — decides the Z-ADJ marker. */
  expenseDate?: string | null;
}

export interface ReimburseJournalInput {
  requestNo: string;
  /** The payment date accounting set. */
  postingDate: string;
  items: ReimburseJournalItem[];
  config: ReimburseJournalConfig;
  /** BU → G/L account, expense lines only (`AccClrBuGlMap`, shared with AP-3). */
  buGlAccounts?: Record<string, string>;
  /** BRANCH → G/L account, expense lines only; checked first, being the more specific. */
  branchGlAccounts?: Record<string, string>;
  departmentCode: string;
  /** Fallback branch for lines that carry none — and for the VAT, WHT and bank lines. */
  defaultBranchCode?: string | null;
  requesterName?: string | null;
  /** Goes to BC as External Document No. — the layout's row 25 asks for รหัสพนักงาน. */
  staffId?: number | null;
  /** Branch → its Location's BU, loaded once per claim by `loadBranchLookup`. */
  branchBu?: ReadonlyMap<string, BranchLookupEntry>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Constant on every VAT line — AP-3's, confirmed by the user 2026-09-08. */
const VAT_GEN_POSTING_TYPE = "Purchase";
const VAT_BUS_POSTING_GROUP = "VATHO";
const VAT_PROD_POSTING_GROUP = "FVAT";

/** BC field widths, cut here rather than rejected there. */
const TAX_INVOICE_NO_MAX = 35;
const TAX_INVOICE_NAME_MAX = 250;
/** `Gen. Journal Line.Description`. The identifying half has to survive the cut. */
const DESCRIPTION_MAX = 100;

/** Trimmed to `max`, or undefined when there is nothing to send. */
function taxText(v: string | null | undefined, max: number): string | undefined {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : undefined;
}

export function buildReimburseJournalPayload(input: ReimburseJournalInput): PpapJournalPayload {
  const { config: c, items, requestNo, postingDate, departmentCode } = input;

  if (!c.bankAccountNo?.trim()) {
    throw new Error("ยังไม่ได้ตั้งค่า Bank Account ของ AP-4 สำหรับแบรนด์นี้");
  }
  if (!c.journalBatchName?.trim()) {
    throw new Error("ยังไม่ได้ตั้งค่า Journal Batch ของ AP-4 สำหรับแบรนด์นี้");
  }
  if (items.length === 0) {
    throw new Error("ไม่มีรายการค่าใช้จ่ายสำหรับสร้าง journal");
  }

  const employeeCode = input.staffId != null ? String(input.staffId).slice(0, 35) : "";
  const defaultBranch = input.defaultBranchCode ?? "";

  /**
   * The BU for a line's branch, or undefined when there is no answer — either
   * no Location for that branch, or a Location carrying no BU. Both send
   * nothing: absence is what makes the codeunit apply its own COCO, where an
   * explicit "COCO" would be indistinguishable from a real answer.
   *
   * Upper-cased on the way in. The branch comes from a picker and the map from
   * BC, and a case mismatch would resolve to nothing and land silently back on
   * COCO.
   */
  const resolveBu = (branchCode: string | null): string | undefined => {
    const key = (branchCode ?? defaultBranch).trim().toUpperCase();
    if (!key) return undefined;
    return input.branchBu?.get(key)?.buCode ?? undefined;
  };

  const who = (input.requesterName ?? "").trim();
  const describe = (detail?: string | null) =>
    [requestNo, "เบิกเงินคืนพนักงาน", who, (detail ?? "").trim()]
      .filter((s) => s !== "")
      .join(" ")
      .slice(0, DESCRIPTION_MAX);

  const glLine = (
    accountNo: string,
    amount: number,
    branchCode: string | null,
    detail?: string | null,
    adjCode?: string,
  ): PpapJournalLinePayload => ({
    groupNo: "G1",
    postingDate,
    // Always a Payment — see the module note.
    documentType: "Payment",
    accountType: "G/L Account",
    accountNo,
    description: describe(detail),
    paymentMethodCode: "BANK",
    amount: r2(amount),
    balAccountType: "G/L Account",
    employeeCode,
    branchCode: branchCode ?? defaultBranch,
    departmentCode,
    // Spread rather than an explicit `undefined`, so an unmarked line
    // serialises exactly as it would have without these features.
    ...(adjCode ? { adjCode } : null),
    ...(resolveBu(branchCode) ? { buCode: resolveBu(branchCode) } : null),
  });

  /**
   * The account this expense posts to: its branch's, else its BU's, else the
   * one it was coded to. Branch first because it names one shop where the BU
   * names a kind of shop, and because some branches have no BU at all.
   */
  const expenseGl = (it: ReimburseJournalItem): string => {
    const branch = (it.branchCode ?? "").trim().toUpperCase();
    const byBranch = branch ? (input.branchGlAccounts ?? {})[branch] : undefined;
    if ((byBranch ?? "").trim()) return byBranch!.trim();
    const bu = resolveBu(it.branchCode);
    const byBu = bu ? (input.buGlAccounts ?? {})[bu] : undefined;
    return (byBu ?? "").trim() || it.glAccountNo;
  };

  const lines: PpapJournalLinePayload[] = [];
  let whtTotal = 0;
  let netPaid = 0;

  for (const it of items) {
    const adj = isPriorPeriod(it.expenseDate, postingDate) ? PRIOR_PERIOD_ADJ_CODE : undefined;

    if (r2(it.amountBeforeVat) !== 0) {
      // The expense line, and only it. The VAT, withholding and bank lines each
      // point at an account of their own; redirecting those by BU would move
      // input tax and cash into a receivable.
      lines.push(glLine(expenseGl(it), it.amountBeforeVat, it.branchCode, it.description, adj));
    }

    const vat = r2(it.vatAmount || 0);
    if (vat > 0) {
      if (!c.vatInputGlAccountNo) {
        throw new Error("มี VAT แต่ยังไม่ได้ตั้งค่าบัญชีภาษีซื้อ (VAT input) ของแบรนด์นี้");
      }
      const invoiceNo = taxText(it.docNo, TAX_INVOICE_NO_MAX);
      const sellerName = taxText(it.payeeName, TAX_INVOICE_NAME_MAX);
      const sellerTaxId = taxText(it.taxId, 20);
      const invoiceDate = (it.expenseDate ?? "").trim() || undefined;
      lines.push({
        ...glLine(c.vatInputGlAccountNo, vat, it.branchCode, it.description, adj),
        // The tax block belongs to the VAT line and to no other: a posting
        // group on an expense or a bank line changes how BC treats it.
        genPostingType: VAT_GEN_POSTING_TYPE,
        vatBusPostingGroup: VAT_BUS_POSTING_GROUP,
        vatProdPostingGroup: VAT_PROD_POSTING_GROUP,
        // Spread individually: a receipt whose seller nobody filled in sends no
        // seller keys, so BC keeps what the vendor card holds rather than
        // having those fields overwritten with blanks.
        ...(invoiceNo ? { taxInvoiceNo: invoiceNo } : null),
        ...(invoiceDate ? { taxInvoiceDate: invoiceDate } : null),
        // The base is what VAT was charged on, not the VAT itself.
        taxInvoiceBase: r2(it.amountBeforeVat),
        ...(sellerName ? { taxInvoiceName: sellerName } : null),
        ...(sellerTaxId ? { taxVatRegistrationNo: sellerTaxId } : null),
        // Left out when unknown so BC keeps the vendor card's own branch,
        // rather than being handed a blank for a tax filing.
        ...(taxText(it.taxBranchCode, 5) ? { taxBranchCode: taxText(it.taxBranchCode, 5) } : null),
        // Set first by the codeunit so its OnValidate can fill the name, branch
        // and VAT registration from the card — the keys above are applied after
        // and win, so a seller read off the receipt is not overwritten.
        ...(taxText(it.taxVendorNo, 20) ? { taxVendorNo: taxText(it.taxVendorNo, 20) } : null),
      });
    }

    whtTotal += it.whtAmount || 0;
    netPaid += it.amountBeforeVat + vat - (it.whtAmount || 0);
  }

  whtTotal = r2(whtTotal);
  netPaid = r2(netPaid);

  if (whtTotal > 0) {
    if (!c.whtPayableGlAccountNo) {
      throw new Error("มีภาษีหัก ณ ที่จ่ายแต่ยังไม่ได้ตั้งค่าบัญชีภาษีหัก ณ ที่จ่ายค้างจ่ายของแบรนด์นี้");
    }
    // One line for the whole claim: the account is the same for every payee,
    // and a line per item would only split one liability into several.
    lines.push(glLine(c.whtPayableGlAccountNo, -whtTotal, input.defaultBranchCode ?? null));
  }

  if (netPaid <= 0) {
    // Every line withheld in full, or a claim that cancels itself out. A bank
    // line of 0 posts a payment document that moves no money, which somebody
    // then has to find and reverse.
    throw new Error("ยอดจ่ายสุทธิของใบนี้ไม่มากกว่า 0 — ตรวจยอดหัก ณ ที่จ่ายก่อนส่ง");
  }
  lines.push(glLine(c.bankAccountNo, -netPaid, input.defaultBranchCode ?? null));

  return { journalBatchName: c.journalBatchName, lines };
}
