/** Client-safe ERP journal description template helpers. */

export const ERP_JOURNAL_DESC_TEMPLATE_KEY = "ERP_JOURNAL_DESC_TEMPLATE";

export const DEFAULT_ERP_JOURNAL_DESC_TEMPLATE =
  "{descPrefix} {branchCode} - {staffId} - {requesterName}";

export const ERP_JOURNAL_DESC_TOKENS = [
  { token: "{brandCode}", label: "แบรนด์เบิก" },
  { token: "{branchCode}", label: "Branch Code" },
  { token: "{staffId}", label: "รหัสพนักงาน" },
  { token: "{requesterName}", label: "ชื่อผู้ขอ" },
  { token: "{deptCode}", label: "รหัสแผนก ERP" },
  { token: "{descPrefix}", label: "คำนำหน้า Description (จาก G/L)" },
] as const;

export interface ErpJournalDescriptionVars {
  brandCode: string;
  branchCode: string;
  staffId: string;
  requesterName: string;
  deptCode: string;
  descPrefix: string;
}

export function normalizeErpJournalDescTemplate(raw: string | null | undefined): string {
  const trimmed = raw?.trim();
  return trimmed || DEFAULT_ERP_JOURNAL_DESC_TEMPLATE;
}

export function applyErpJournalDescriptionTemplate(
  template: string,
  vars: ErpJournalDescriptionVars,
): string {
  const normalized = normalizeErpJournalDescTemplate(template);
  return normalized
    .split("{brandCode}").join(vars.brandCode)
    .split("{branchCode}").join(vars.branchCode)
    .split("{staffId}").join(vars.staffId)
    .split("{requesterName}").join(vars.requesterName)
    .split("{deptCode}").join(vars.deptCode)
    .split("{descPrefix}").join(vars.descPrefix)
    .replace(/\s+/g, " ")
    .trim();
}

export function sampleErpJournalDescription(template: string): string {
  return applyErpJournalDescriptionTemplate(template, {
    brandCode: "KSI",
    branchCode: "HQ01",
    staffId: "12345",
    requesterName: "Sattawat Chaiyen",
    deptCode: "ACC",
    descPrefix: "ค่าเดินทาง",
  });
}
