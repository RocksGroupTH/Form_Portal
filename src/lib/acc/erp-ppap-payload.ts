import {
  erpJournalLinePairKey,
  type ErpJournalGroup,
  type ErpJournalLine,
} from "@/lib/acc/erp-journal-builder";

export interface PpapJournalLinePayload {
  groupNo: string;
  postingDate: string;
  documentType: string;
  accountType: string;
  accountNo: string;
  description: string;
  paymentMethodCode: string;
  amount: number;
  balAccountType?: string;
  employeeCode: string;
  branchCode: string;
  departmentCode: string;
  /**
   * Z-ADJ dimension value. Codeunit 50263 reads this key and writes the
   * dimension (`APJournalCreate.al:238`); omitted, the line simply carries no
   * Z-ADJ value, which is what every line sent before this did.
   */
  adjCode?: string;
  /**
   * BU dimension value — the Business Unit the line's Location is bound to.
   * Codeunit 50263 reads this key and falls back to `COCO` when it is missing
   * (`APJournalCreate.al:293`), which is the constant every line carried before
   * the portal could resolve it. Omitted rather than sent blank: absence is what
   * triggers that fallback, where a blank string would be sent as an answer.
   */
  buCode?: string;

  /* ── The tax block, VAT lines only (spec §5.4, sheet row 8) ──────────────
   *
   * Every key is optional and omitted when it has no value: codeunit 50263
   * applies each only when non-blank, so a payload without them leaves the
   * corresponding BC field untouched rather than blanking it.
   *
   * The first three are standard `Gen. Journal Line` fields. The rest come from
   * `NWTH CustomizationRevolic` (tableextension 80105) — and two of those are
   * named differently in AL from the interface sheet's wording: `taxBranchCode`
   * is the field `Branch Code`, and `taxVatRegistrationNo` is
   * `Revolic VAT Registration No.`
   */
  genPostingType?: string;
  vatBusPostingGroup?: string;
  vatProdPostingGroup?: string;
  /** `Tax Invoice No.` — Code[35]. */
  taxInvoiceNo?: string;
  /** `Tax Invoice Date` — the receipt's own date, not the journal's. */
  taxInvoiceDate?: string;
  /** `Tax Invoice Base` — the amount VAT was charged on, not the VAT. */
  taxInvoiceBase?: number;
  /** `Tax Invoice Name` — Text[250]. */
  taxInvoiceName?: string;
  /** `Revolic VAT Registration No.` — the seller's tax id. */
  taxVatRegistrationNo?: string;
  /**
   * `Tax Vendor No.` — not sent by AP-3, which matches no vendor for a seller.
   * Declared because the codeunit accepts it and its OnValidate fills the name,
   * branch and VAT registration from the vendor card: the day AP-3 learns to
   * match sellers, this one key replaces three.
   */
  taxVendorNo?: string;
  /** `Branch Code` on the journal line — the sheet calls it Tax Branch Code. */
  taxBranchCode?: string;
}

export interface PpapJournalPayload {
  journalBatchName: string;
  lines: PpapJournalLinePayload[];
}

function postingMonth(postingDate: string): string {
  const d = postingDate.trim();
  return d.length >= 7 ? d.slice(0, 7) : d;
}

function collectReadyJournalLines(group: ErpJournalGroup): ErpJournalLine[] {
  const lines: ErpJournalLine[] = [];
  for (const batch of group.paymentBatches) {
    if (batch.prepStatus !== "ready" || batch.lines.length === 0) continue;
    for (const line of batch.lines) lines.push(line);
  }
  return lines;
}

/**
 * Assign PPAP groupNo per G/L + Bank pair (G1, G2, …).
 * Counter runs continuously across posting months within one payload.
 */
export function buildPpapGroupNoByPairKey(lines: ErpJournalLine[]): Map<string, string> {
  const pairs: { pairKey: string; month: string; postingDate: string }[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const pairKey = erpJournalLinePairKey(line);
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    pairs.push({
      pairKey,
      month: postingMonth(line.postingDate),
      postingDate: line.postingDate,
    });
  }

  pairs.sort((a, b) => {
    const monthCmp = a.month.localeCompare(b.month);
    if (monthCmp !== 0) return monthCmp;
    const dateCmp = a.postingDate.localeCompare(b.postingDate);
    if (dateCmp !== 0) return dateCmp;
    return a.pairKey.localeCompare(b.pairKey);
  });

  const map = new Map<string, string>();
  let index = 0;

  for (const { pairKey } of pairs) {
    index += 1;
    map.set(pairKey, `G${index}`);
  }

  return map;
}

export function ppapGroupNoForLine(line: ErpJournalLine, groupNoByPairKey: Map<string, string>): string {
  return groupNoByPairKey.get(erpJournalLinePairKey(line)) ?? "";
}

function parseGroupNoIndex(groupNo: string): number {
  const m = /^G(\d+)$/i.exec(groupNo.trim());
  return m ? parseInt(m[1], 10) : 0;
}

/** Posting date ascending, then Group G1→Gn, then G/L before Bank within each pair. */
export function sortJournalLinesForPpap(
  lines: ErpJournalLine[],
  groupNoByPairKey: Map<string, string>,
): ErpJournalLine[] {
  return Array.from(lines).sort((a, b) => {
    const dateCmp = a.postingDate.localeCompare(b.postingDate);
    if (dateCmp !== 0) return dateCmp;
    const ga = parseGroupNoIndex(ppapGroupNoForLine(a, groupNoByPairKey));
    const gb = parseGroupNoIndex(ppapGroupNoForLine(b, groupNoByPairKey));
    if (ga !== gb) return ga - gb;
    if (a.accountType !== b.accountType) {
      if (a.accountType === "G/L Account") return -1;
      if (b.accountType === "G/L Account") return 1;
    }
    return a.accountNo.localeCompare(b.accountNo);
  });
}

function mapJournalLineToPpap(line: ErpJournalLine, groupNo: string): PpapJournalLinePayload {
  const employeeCode = line.externalDocument?.trim() || "";
  const base: PpapJournalLinePayload = {
    groupNo,
    postingDate: line.postingDate,
    documentType: line.documentType,
    accountType: line.accountType,
    accountNo: line.accountNo,
    description: line.description,
    paymentMethodCode: line.paymentMethodCode,
    amount: line.amount,
    employeeCode,
    branchCode: line.branchCode,
    departmentCode: line.departmentCode,
  };
  if (line.accountType === "G/L Account") {
    base.balAccountType = "G/L Account";
  }
  return base;
}

/** Build PPAP payload from journal lines (shared by single-group and batch send). */
function buildPpapJournalPayloadFromLines(
  rawLines: ErpJournalLine[],
  journalBatchName: string,
): PpapJournalPayload {
  const groupNoByPairKey = buildPpapGroupNoByPairKey(rawLines);
  const sorted = sortJournalLinesForPpap(rawLines, groupNoByPairKey);

  const lines: PpapJournalLinePayload[] = [];
  for (const line of sorted) {
    const groupNo = ppapGroupNoForLine(line, groupNoByPairKey) || "G1";
    lines.push(mapJournalLineToPpap(line, groupNo));
  }

  return {
    journalBatchName: journalBatchName.trim(),
    lines,
  };
}

function collectReadyJournalLinesFromGroups(groups: ErpJournalGroup[]): ErpJournalLine[] {
  const lines: ErpJournalLine[] = [];
  for (const group of groups) {
    lines.push(...collectReadyJournalLines(group));
  }
  return lines;
}

/** Build PPAP CreateFromJson payload for multiple person groups (one interface batch). */
export function buildPpapJournalPayloadFromGroups(
  groups: ErpJournalGroup[],
  journalBatchName: string,
): PpapJournalPayload {
  return buildPpapJournalPayloadFromLines(
    collectReadyJournalLinesFromGroups(groups),
    journalBatchName,
  );
}

export function collectPersonGroupRequestIds(group: ErpJournalGroup): number[] {
  const ids = new Set<number>();
  for (const batch of group.paymentBatches) {
    for (const source of batch.sources) {
      ids.add(source.id);
    }
  }
  return Array.from(ids);
}

export function collectGroupsRequestIds(groups: ErpJournalGroup[]): number[] {
  const ids = new Set<number>();
  for (const group of groups) {
    for (const id of collectPersonGroupRequestIds(group)) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}
