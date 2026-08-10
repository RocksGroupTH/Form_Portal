export interface ErpOption {
  dimensionCode: string;
  code: string;
  displayName: string | null;
}

export interface GlOption {
  accountNo: string;
  displayName: string | null;
}

export interface MappingRow {
  departmentCode: string;
  departmentName: string | null;
  erpDimensionCode: string;
  erpCode: string | null;
  erpDisplayName: string | null;
  mappedAt: string | null;
  fixedGlAccountNo: string | null;
  fixedGlDescription: string | null;
}

export interface ClaimBrandRef {
  claimBrandCode: string;
  brandName: string;
  brandLogo: string | null;
}

export interface TargetGroup {
  targetBrandCode: string;
  targetBrandName: string | null;
  targetBrandLogo: string | null;
  claimBrands: ClaimBrandRef[];
  bcConfigReady: boolean;
  dimensionCode: string;
  erpOptions: ErpOption[];
  glOptions: GlOption[];
  mappings: MappingRow[];
  mappedCount: number;
  totalCount: number;
  lastSync: {
    status: string;
    rowsUpserted: number;
    errorMessage: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
}

export interface DepartmentMappingPageData {
  dimensionCode: string;
  groups: TargetGroup[];
  unassignedClaims: ClaimBrandRef[];
}

export type MapFilter = "all" | "mapped" | "unmapped";

export function deptInitials(name: string | null): string {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function erpLabel(o: ErpOption): string {
  return o.displayName ? `${o.code} — ${o.displayName}` : o.code;
}

export function mappingsToErpMap(mappings: MappingRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of mappings) {
    out[m.departmentCode] = m.erpCode ?? "";
  }
  return out;
}

export function mappingsToGlMap(mappings: MappingRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of mappings) {
    out[m.departmentCode] = m.fixedGlAccountNo ?? "";
  }
  return out;
}

export function mappingsToGlDescMap(mappings: MappingRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of mappings) {
    out[m.departmentCode] = m.fixedGlDescription ?? "";
  }
  return out;
}

export function isBrandMapDirty(
  draft: Record<string, string>,
  saved: Record<string, string>,
  codes: string[],
): boolean {
  return codes.some((code) => (draft[code]?.trim() ?? "") !== (saved[code]?.trim() ?? ""));
}

export function erpDimensionHasCode(options: ErpOption[], code: string): boolean {
  const key = code.trim().toUpperCase();
  if (!key) return false;
  for (const opt of options) {
    if (opt.code.trim().toUpperCase() === key) return true;
  }
  return false;
}
