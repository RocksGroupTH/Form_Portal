import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import type { ErpPrepStatus } from "@/features/accounting/constants";
import type { ErpPrepRow } from "@/lib/acc/erp-prep-service";
import {
  applyErpJournalDescriptionTemplate,
  normalizeErpJournalDescTemplate,
} from "@/lib/acc/erp-journal-description";

/**
 * Default/base ERP target brand when a claim brand has no explicit
 * interface mapping. Mirrors `ERP_SYNC_BRAND_CODE` in
 * "@/lib/erp/dimension-sync" (same value, "PCTH") — kept as a local
 * constant instead of importing it because this module is bundled into
 * client components (e.g. ErpPrepQueue.tsx calls buildErpJournalSections
 * directly) and dimension-sync.ts pulls in server-only mssql/tedious deps.
 */
const ERP_SYNC_BRAND_CODE = "PCTH";

export interface BrandErpAccountConfig {
  glAccountNo: string | null;
  erpDescription: string | null;
  bankAccountNo: string | null;
  branchCode: string | null;
  journalBatchName: string | null;
  deptAsBranch: boolean;
  fixedErpDeptCode: string | null;
}

export interface ErpInterfaceClaimChip {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
}

export interface ErpInterfaceTargetMeta {
  targetBrandCode: string;
  targetBrandName: string;
  targetBrandLogo: string;
  claimBrands: ErpInterfaceClaimChip[];
  journalBatchName: string | null;
  bcMeta: string | null;
  bcEnvironment?: "Production" | "Sandbox";
  bcProfileComplete?: boolean;
}

export interface ErpJournalBuildContext {
  descriptionTemplate: string;
  brandAccounts: Record<string, BrandErpAccountConfig>;
  interfaceByClaim: Record<string, string>;
  targetMeta: ErpInterfaceTargetMeta[];
  erpDeptCodesByTarget: Record<string, string[]>;
  deptGlOverridesByTarget: Record<string, Record<string, { accountNo: string; description: string }>>;
  erpEnvironment: "Production" | "Sandbox";
  canUseSandbox: boolean;
}

export interface ErpJournalLine {
  postingDate: string;
  documentType: "Payment";
  accountType: "G/L Account" | "Bank Account";
  accountNo: string;
  description: string;
  paymentMethodCode: "BANK";
  branchCode: string;
  vatCode: "0000";
  departmentCode: string;
  amount: number;
  debitAmount: number | null;
  creditAmount: number | null;
  externalDocument: string;
  personGroupKey?: string;
}

export interface ErpJournalPaymentBatch {
  postingDate: string;
  totalAmount: number;
  sourceCount: number;
  sourcesSum: number;
  amountsMatch: boolean;
  prepStatus: ErpPrepStatus;
  prepIssues: string[];
  lines: ErpJournalLine[];
  sources: ErpPrepRow[];
}

export interface ErpJournalGroup {
  groupKey: string;
  staffId: number | null;
  requesterName: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  interfaceTargetCode: string | null;
  journalBatchName: string | null;
  totalAmount: number;
  sourceCount: number;
  prepStatus: ErpPrepStatus;
  prepIssues: string[];
  paymentBatches: ErpJournalPaymentBatch[];
}

export interface ErpJournalSectionSummary {
  personGroupCount: number;
  ready: number;
  incomplete: number;
  totalAmount: number;
  lineCount: number;
}

export interface ErpInterfaceTargetSection {
  targetBrandCode: string;
  targetBrandName: string;
  targetBrandLogo: string;
  claimBrands: ErpInterfaceClaimChip[];
  journalBatchName: string | null;
  bcMeta: string | null;
  personGroups: ErpJournalGroup[];
  allLines: ErpJournalLine[];
  summary: ErpJournalSectionSummary;
}

export interface ErpJournalUnassignedSection {
  personGroups: ErpJournalGroup[];
  allLines: ErpJournalLine[];
  summary: ErpJournalSectionSummary;
}

export interface ErpJournalBuildResult {
  sections: ErpInterfaceTargetSection[];
  unassigned: ErpJournalUnassignedSection;
  summary: {
    interfaceSectionCount: number;
    personGroupCount: number;
    ready: number;
    incomplete: number;
    totalAmount: number;
  };
}

const UNASSIGNED_KEY = "__UNASSIGNED__";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumSourceAmounts(sources: ErpPrepRow[]): number {
  let sum = 0;
  for (const s of sources) {
    sum += Number(s.totalAmount) || 0;
  }
  return roundMoney(sum);
}

function personGroupKeyForRow(row: ErpPrepRow): string {
  const staff = row.staffId != null ? String(row.staffId) : "";
  const dept = row.erpDeptCode ?? "";
  return `${staff}|${dept}`;
}

function groupSourcesByPaymentDate(sources: ErpPrepRow[]): Map<string, ErpPrepRow[]> {
  const map = new Map<string, ErpPrepRow[]>();
  for (const s of sources) {
    const payment = s.paymentDate ?? "";
    const list = map.get(payment) ?? [];
    list.push(s);
    map.set(payment, list);
  }
  return map;
}

function groupSourcesByBrand(sources: ErpPrepRow[]): Map<string, ErpPrepRow[]> {
  const map = new Map<string, ErpPrepRow[]>();
  for (const s of sources) {
    const brand = (s.brandCode ?? "").trim().toUpperCase() || "__NONE__";
    const list = map.get(brand) ?? [];
    list.push(s);
    map.set(brand, list);
  }
  return map;
}

function resolveInterfaceTarget(
  row: ErpPrepRow,
  interfaceByClaim: Record<string, string>,
): string {
  const claim = (row.brandCode ?? "").trim().toUpperCase();
  if (!claim) return UNASSIGNED_KEY;
  const target = interfaceByClaim[claim];
  return target?.trim().toUpperCase() || UNASSIGNED_KEY;
}

function brandConfig(
  ctx: ErpJournalBuildContext,
  brandCode: string | null | undefined,
): BrandErpAccountConfig | null {
  if (!brandCode) return null;
  return ctx.brandAccounts[brandCode.toUpperCase()] ?? null;
}

/** HR-mapped dept on the request, unless brand has Fix Dept from ERP settings. */
function resolveJournalDepartmentCode(
  cfg: BrandErpAccountConfig | null,
  hrDepartmentCode: string,
): string {
  const fixed = cfg?.fixedErpDeptCode?.trim();
  if (fixed && cfg?.deptAsBranch) return fixed;
  return hrDepartmentCode;
}

function computeGroupIssues(
  sources: ErpPrepRow[],
  ctx: ErpJournalBuildContext,
  targetJournalBatch: string | null,
): string[] {
  const issues = new Set<string>();

  for (const s of sources) {
    for (const issue of s.prepIssues) issues.add(issue);
  }

  const brandCodes = new Set<string>();
  for (const s of sources) {
    const code = s.brandCode?.trim().toUpperCase();
    if (code) brandCodes.add(code);
    else issues.add("ไม่มีแบรนด์เบิก");
  }

  for (const brandCode of Array.from(brandCodes)) {
    const cfg = brandConfig(ctx, brandCode);
    if (!cfg?.glAccountNo) issues.add(`ยังไม่ตั้ง G/L Account สำหรับแบรนด์เบิก ${brandCode}`);
    if (!cfg?.bankAccountNo) issues.add(`ยังไม่ตั้ง Bank Account สำหรับแบรนด์เบิก ${brandCode}`);
    if (!cfg?.branchCode) issues.add(`ยังไม่ตั้ง Branch Code สำหรับแบรนด์เบิก ${brandCode}`);
    if (cfg?.deptAsBranch) {
      const fixed = cfg.fixedErpDeptCode?.trim();
      if (!fixed) {
        issues.add(`ยังไม่ได้เลือกแผนก ERP (Dept) สำหรับแบรนด์เบิก ${brandCode}`);
      } else {
        const target = ctx.interfaceByClaim[brandCode]?.trim().toUpperCase() ?? "";
        const deptCodes = ctx.erpDeptCodesByTarget[target] ?? [];
        const fixedKey = fixed.toUpperCase();
        let deptFound = false;
        for (const code of deptCodes) {
          if (code.toUpperCase() === fixedKey) {
            deptFound = true;
            break;
          }
        }
        if (!deptFound) {
          issues.add(
            `ไม่พบ Department ใน ERP รหัส ${fixed} (แบรนด์เบิก ${brandCode})`,
          );
        }
      }
    }
  }

  if (!targetJournalBatch) issues.add("ยังไม่ตั้ง Journal Batch สำหรับกลุ่ม Interface");

  const missingStaff = sources.some((s) => s.staffId == null);
  if (missingStaff) issues.add("บางรายการไม่มีรหัสพนักงาน (StaffId)");

  return Array.from(issues);
}

function buildJournalLines(input: {
  postingDate: string;
  totalAmount: number;
  glAccountNo: string;
  bankAccountNo: string;
  branchCode: string;
  departmentCode: string;
  description: string;
  staffId: number | null;
  personGroupKey: string;
}): ErpJournalLine[] {
  const amount = roundMoney(input.totalAmount);
  const external = input.staffId != null ? String(input.staffId) : "";
  const base = {
    postingDate: input.postingDate,
    documentType: "Payment" as const,
    description: input.description,
    paymentMethodCode: "BANK" as const,
    branchCode: input.branchCode,
    vatCode: "0000" as const,
    departmentCode: input.departmentCode,
    externalDocument: external,
    personGroupKey: input.personGroupKey,
  };

  return [
    {
      ...base,
      accountType: "G/L Account",
      accountNo: input.glAccountNo,
      amount,
      debitAmount: amount > 0 ? amount : null,
      creditAmount: null,
    },
    {
      ...base,
      accountType: "Bank Account",
      accountNo: input.bankAccountNo,
      amount: -amount,
      debitAmount: null,
      creditAmount: amount > 0 ? amount : null,
    },
  ];
}

function lineMergeKey(line: ErpJournalLine): string {
  return [
    line.postingDate,
    line.accountType,
    line.accountNo,
    line.branchCode,
    line.departmentCode,
    line.externalDocument,
  ].join("|");
}

/** Groups a G/L + Bank pair (same posting date, branch, dept, staff, amount). */
export function erpJournalLinePairKey(line: ErpJournalLine): string {
  return [
    line.postingDate,
    line.branchCode,
    line.departmentCode,
    line.externalDocument,
    String(roundMoney(Math.abs(line.amount))),
  ].join("|");
}

function journalLinePairKey(line: ErpJournalLine): string {
  return erpJournalLinePairKey(line);
}

function compareJournalLinesInterleaved(
  a: ErpJournalLine,
  b: ErpJournalLine,
  postingDateDesc: boolean,
): number {
  if (a.postingDate !== b.postingDate) {
    return postingDateDesc
      ? b.postingDate.localeCompare(a.postingDate)
      : a.postingDate.localeCompare(b.postingDate);
  }

  const pairA = journalLinePairKey(a);
  const pairB = journalLinePairKey(b);
  if (pairA !== pairB) {
    const amtCmp = Math.abs(a.amount) - Math.abs(b.amount);
    if (amtCmp !== 0) return amtCmp;
    if (a.branchCode !== b.branchCode) return a.branchCode.localeCompare(b.branchCode);
    return pairA.localeCompare(pairB);
  }

  if (a.accountType !== b.accountType) {
    if (a.accountType === "G/L Account") return -1;
    if (b.accountType === "G/L Account") return 1;
  }
  return a.accountNo.localeCompare(b.accountNo);
}

/** Display order: newest posting date first, G/L then Bank within each pair. */
export function sortJournalLinesForDisplay(lines: ErpJournalLine[]): ErpJournalLine[] {
  return Array.from(lines).sort((a, b) => compareJournalLinesInterleaved(a, b, true));
}

/** Sum journal lines that share the same posting date and account dimensions. */
function mergeJournalLinesByPostingDate(lines: ErpJournalLine[]): ErpJournalLine[] {
  const merged = new Map<string, ErpJournalLine>();

  for (const line of lines) {
    const key = lineMergeKey(line);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...line });
      continue;
    }

    const amount = roundMoney(existing.amount + line.amount);
    const debit =
      existing.debitAmount != null || line.debitAmount != null
        ? roundMoney((existing.debitAmount ?? 0) + (line.debitAmount ?? 0))
        : null;
    const credit =
      existing.creditAmount != null || line.creditAmount != null
        ? roundMoney((existing.creditAmount ?? 0) + (line.creditAmount ?? 0))
        : null;

    merged.set(key, {
      ...existing,
      amount,
      debitAmount: debit != null && debit !== 0 ? debit : null,
      creditAmount: credit != null && credit !== 0 ? credit : null,
    });
  }

  return Array.from(merged.values()).sort((a, b) =>
    compareJournalLinesInterleaved(a, b, false),
  );
}

function summarizePersonGroups(groups: ErpJournalGroup[]): ErpJournalSectionSummary {
  let ready = 0;
  let incomplete = 0;
  let totalAmount = 0;
  let lineCount = 0;
  for (const g of groups) {
    if (g.prepStatus === "ready") ready++;
    else incomplete++;
    totalAmount += g.totalAmount;
    for (const batch of g.paymentBatches) {
      lineCount += batch.lines.length;
    }
  }
  return {
    personGroupCount: groups.length,
    ready,
    incomplete,
    totalAmount: roundMoney(totalAmount),
    lineCount,
  };
}

function buildPaymentBatch(
  sources: ErpPrepRow[],
  postingDate: string,
  groupKey: string,
  ctx: ErpJournalBuildContext,
  targetJournalBatch: string | null,
  template: string,
): ErpJournalPaymentBatch {
  const sorted = Array.from(sources).sort((a, b) => {
    const an = a.requestNo ?? "";
    const bn = b.requestNo ?? "";
    if (an !== bn) return an.localeCompare(bn);
    return a.id - b.id;
  });

  const departmentCode = sorted[0]?.erpDeptCode ?? "";
  const sourcesSum = sumSourceAmounts(sorted);
  const totalAmount = sourcesSum;
  const prepIssues = computeGroupIssues(sorted, ctx, targetJournalBatch);
  const prepStatus: ErpPrepStatus = prepIssues.length === 0 ? "ready" : "incomplete";

  const rawLines: ErpJournalLine[] = [];
  if (prepStatus === "ready" && postingDate) {
    const byBrand = groupSourcesByBrand(sorted);
    for (const [brandKey, brandSources] of Array.from(byBrand.entries())) {
      const rowBrandCode = brandKey === "__NONE__" ? null : brandKey;
      const cfg = brandConfig(ctx, rowBrandCode);
      if (!cfg?.glAccountNo || !cfg?.bankAccountNo) continue;

      const subTotal = sumSourceAmounts(brandSources);
      const brandFirst = brandSources[0];

      const targetForOverride =
        ctx.interfaceByClaim[(rowBrandCode ?? "").toUpperCase()] ?? ERP_SYNC_BRAND_CODE;
      const deptCodeForOverride = brandFirst.requesterDepartmentCode?.trim() ?? "";
      const deptOverride = deptCodeForOverride
        ? ctx.deptGlOverridesByTarget?.[targetForOverride]?.[deptCodeForOverride]
        : undefined;

      const effectiveGlAccountNo = deptOverride?.accountNo?.trim() || cfg.glAccountNo;
      const descPrefix = (deptOverride?.description?.trim() || cfg.erpDescription?.trim()) ?? "";
      const branchCode = cfg.branchCode?.trim() ?? "";
      const lineDepartmentCode = resolveJournalDepartmentCode(cfg, departmentCode);
      const description = applyErpJournalDescriptionTemplate(template, {
        brandCode: (rowBrandCode ?? "").toUpperCase(),
        branchCode,
        staffId: brandFirst.staffId != null ? String(brandFirst.staffId) : "",
        requesterName: brandFirst.requesterFullName?.trim() ?? "",
        deptCode: lineDepartmentCode,
        descPrefix,
      });

      rawLines.push(
        ...buildJournalLines({
          postingDate,
          totalAmount: subTotal,
          glAccountNo: effectiveGlAccountNo,
          bankAccountNo: cfg.bankAccountNo,
          branchCode,
          departmentCode: lineDepartmentCode,
          description,
          staffId: brandFirst.staffId,
          personGroupKey: `${groupKey}|${postingDate}`,
        }),
      );
    }
  }

  return {
    postingDate,
    totalAmount,
    sourceCount: sorted.length,
    sourcesSum,
    amountsMatch: roundMoney(sourcesSum) === roundMoney(totalAmount),
    prepStatus,
    prepIssues,
    lines: mergeJournalLinesByPostingDate(rawLines),
    sources: sorted,
  };
}

function buildPersonGroupsForRows(
  rows: ErpPrepRow[],
  ctx: ErpJournalBuildContext,
  interfaceTargetCode: string | null,
  targetJournalBatch: string | null,
): ErpJournalGroup[] {
  const template = normalizeErpJournalDescTemplate(ctx.descriptionTemplate);
  const byKey = new Map<string, ErpPrepRow[]>();

  for (const row of rows) {
    const key = personGroupKeyForRow(row);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const groups: ErpJournalGroup[] = [];

  for (const [groupKey, sources] of Array.from(byKey.entries())) {
    const first = sources[0];
    const byPayment = groupSourcesByPaymentDate(sources);
    const paymentBatches: ErpJournalPaymentBatch[] = Array.from(byPayment.entries())
      .map(([postingDate, batchSources]) =>
        buildPaymentBatch(
          batchSources,
          postingDate,
          groupKey,
          ctx,
          targetJournalBatch,
          template,
        ),
      )
      .sort((a, b) => b.postingDate.localeCompare(a.postingDate));

    let totalAmount = 0;
    let sourceCount = 0;
    const prepIssues = new Set<string>();
    let prepStatus: ErpPrepStatus = "ready";
    for (const batch of paymentBatches) {
      totalAmount += batch.totalAmount;
      sourceCount += batch.sourceCount;
      for (const issue of batch.prepIssues) prepIssues.add(issue);
      if (batch.prepStatus !== "ready") prepStatus = "incomplete";
    }

    groups.push({
      groupKey,
      staffId: first.staffId,
      requesterName: first.requesterFullName,
      departmentCode: first.erpDeptCode,
      departmentName: first.erpDeptDisplayName ?? first.requesterDepartmentName,
      interfaceTargetCode,
      journalBatchName: targetJournalBatch,
      totalAmount: roundMoney(totalAmount),
      sourceCount,
      prepStatus,
      prepIssues: Array.from(prepIssues),
      paymentBatches,
    });
  }

  groups.sort((a, b) => {
    const an = a.requesterName ?? "";
    const bn = b.requesterName ?? "";
    if (an !== bn) return an.localeCompare(bn);
    return (a.departmentCode ?? "").localeCompare(b.departmentCode ?? "");
  });

  return groups;
}

/** @deprecated Use buildErpJournalSections */
export function buildErpJournalGroups(
  rows: ErpPrepRow[],
  ctx: ErpJournalBuildContext,
): { groups: ErpJournalGroup[]; summary: ErpJournalBuildResult["summary"] } {
  const result = buildErpJournalSections(rows, ctx);
  const groups = result.sections.flatMap((s) => s.personGroups)
    .concat(result.unassigned.personGroups);
  return {
    groups,
    summary: {
      interfaceSectionCount: result.summary.interfaceSectionCount,
      personGroupCount: result.summary.personGroupCount,
      ready: result.summary.ready,
      incomplete: result.summary.incomplete,
      totalAmount: result.summary.totalAmount,
    },
  };
}

export function buildErpJournalSections(
  rows: ErpPrepRow[],
  ctx: ErpJournalBuildContext,
): ErpJournalBuildResult {
  const rowsByTarget = new Map<string, ErpPrepRow[]>();

  for (const row of rows) {
    const target = resolveInterfaceTarget(row, ctx.interfaceByClaim);
    const list = rowsByTarget.get(target) ?? [];
    list.push(row);
    rowsByTarget.set(target, list);
  }

  const metaByTarget = new Map(
    ctx.targetMeta.map((m) => [m.targetBrandCode.toUpperCase(), m]),
  );

  const sections: ErpInterfaceTargetSection[] = [];

  for (const iface of ERP_INTERFACE_BRANDS) {
    const code = iface.id.toUpperCase();
    const targetRows = rowsByTarget.get(code) ?? [];
    if (targetRows.length === 0) continue;

    const meta = metaByTarget.get(code);
    const personGroups = buildPersonGroupsForRows(
      targetRows,
      ctx,
      code,
      meta?.journalBatchName ?? null,
    );
    const allLines = personGroups.flatMap((g) =>
      g.paymentBatches.flatMap((b) => b.lines),
    );

    sections.push({
      targetBrandCode: code,
      targetBrandName: meta?.targetBrandName ?? iface.name,
      targetBrandLogo: meta?.targetBrandLogo ?? `/brandlogo/${code.toLowerCase()}-200.png`,
      claimBrands: meta?.claimBrands ?? [],
      journalBatchName: meta?.journalBatchName ?? null,
      bcMeta: meta?.bcMeta ?? null,
      personGroups,
      allLines,
      summary: summarizePersonGroups(personGroups),
    });
  }

  const unassignedRows = rowsByTarget.get(UNASSIGNED_KEY) ?? [];
  const unassignedGroups = buildPersonGroupsForRows(unassignedRows, ctx, null, null);
  const unassigned: ErpJournalUnassignedSection = {
    personGroups: unassignedGroups,
    allLines: unassignedGroups.flatMap((g) => g.paymentBatches.flatMap((b) => b.lines)),
    summary: summarizePersonGroups(unassignedGroups),
  };

  let ready = 0;
  let incomplete = 0;
  let totalAmount = 0;
  let personGroupCount = 0;

  for (const section of sections) {
    ready += section.summary.ready;
    incomplete += section.summary.incomplete;
    totalAmount += section.summary.totalAmount;
    personGroupCount += section.summary.personGroupCount;
  }
  ready += unassigned.summary.ready;
  incomplete += unassigned.summary.incomplete;
  totalAmount += unassigned.summary.totalAmount;
  personGroupCount += unassigned.summary.personGroupCount;

  return {
    sections,
    unassigned,
    summary: {
      interfaceSectionCount: sections.length + (unassigned.personGroups.length > 0 ? 1 : 0),
      personGroupCount,
      ready,
      incomplete,
      totalAmount: roundMoney(totalAmount),
    },
  };
}
