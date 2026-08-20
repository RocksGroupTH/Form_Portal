"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import { ExternalLink, CheckCircle2, ChevronRight, Circle, GitBranch, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";
import {
  ErpAccountSyncPopup,
  type ErpSyncPopupState,
} from "@/features/accounting/components/settings/ErpAccountSyncPopup";
import {
  buildAllTargetErpGroups,
  buildTargetErpGroups,
  claimCodesForGroup,
  groupMemberCodes,
  resolveJournalForTarget,
  unassignedClaimBrands,
  type TargetErpGroup,
} from "@/features/accounting/components/settings/brand-erp-interface-groups";
import { erpDescriptionFromGlOption } from "@/lib/acc/erp-description";
import { ErpJournalTemplateSettings } from "@/features/accounting/components/settings/ErpJournalTemplateSettings";
import { ErpDeptFixDialog } from "@/features/accounting/components/settings/ErpDeptFixDialog";
import { useAccSettingsDeepLink } from "@/features/accounting/lib/use-acc-settings-deep-link";
import { useAccountingAccess } from "@/features/accounting/hooks/useAccountingAccess";
import type {
  AccBrandAccountRow,
  AccBrandBranchRow,
  AccBrandErpConfigRow,
  AccBrandJournalBatchRow,
  AccErpTargetBrandOption,
} from "@/features/accounting/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const SYNC_PHASES = [
  { phase: "journalBatch", label: "Journal Batch" },
  { phase: "gl", label: "G/L Account" },
  { phase: "bank", label: "Bank Account" },
  { phase: "branch", label: "Branch Code" },
] as const;

type SyncPhaseKey = (typeof SYNC_PHASES)[number]["phase"];

const DEFAULT_SYNC_PHASES: Record<SyncPhaseKey, boolean> = {
  journalBatch: false,
  gl: false,
  bank: false,
  branch: false,
};

interface PageData {
  brands: AccBrandErpConfigRow[];
  targetBrands: AccErpTargetBrandOption[];
}

interface ErpAccountOption {
  accountNo: string;
  displayName: string | null;
  bcCategory: string | null;
}

interface ErpBranchOption {
  code: string;
  displayName: string | null;
}

interface ErpJournalBatchOption {
  batchName: string;
  displayName: string | null;
  templateName: string | null;
}

type ErpAccountsByBrand = Record<string, {
  gl: ErpAccountOption[];
  bank: ErpAccountOption[];
  journalBatch: ErpJournalBatchOption[];
  branch: ErpBranchOption[];
  department: ErpDimensionOption[];
}>;

type ErpDimensionOption = {
  code: string;
  displayName: string | null;
  dimensionCode?: string;
};

interface BrandDraft {
  journalBatchName: string;
  glAccountNo: string;
  erpDescription: string;
  bankAccountNo: string;
  branchCode: string;
  deptAsBranch: boolean;
  fixedErpDeptCode: string;
  journalBatchId?: number;
  glId?: number;
  bankId?: number;
  branchId?: number;
}

function isBranchConfigDirty(draft: BrandDraft, saved: BrandDraft): boolean {
  return draft.branchCode.trim() !== saved.branchCode.trim()
    || draft.deptAsBranch !== saved.deptAsBranch
    || draft.fixedErpDeptCode.trim() !== saved.fixedErpDeptCode.trim();
}

function validateDeptAsBranchForDraft(
  draft: BrandDraft,
  targetCode: string,
  erpByBrand: ErpAccountsByBrand,
  brandName: string,
): string | null {
  if (!draft.deptAsBranch) return null;
  const fixed = draft.fixedErpDeptCode.trim();
  if (!fixed) return `กรุณาเลือก Fix Dept สำหรับ ${brandName}`;
  const departments = erpByBrand[targetCode.trim().toUpperCase()]?.department ?? [];
  const key = fixed.toUpperCase();
  for (const dept of departments) {
    if (dept.code.trim().toUpperCase() === key) return null;
  }
  return `ไม่พบ Department ใน ERP รหัส ${fixed} สำหรับ ${brandName}`;
}

function decodeBcName(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return value.trim();
  }
}

function brandIconUrl(brandCode: string, logo?: string | null): string {
  if (logo?.trim()) return logo.trim();
  return `/brandlogo/${brandCode.trim().toLowerCase()}-200.png`;
}

function targetBrandSelectOptions(targetBrands: AccErpTargetBrandOption[]) {
  return targetBrands.map((t) => ({
    value: t.brandCode,
    label: t.brandCode,
    subLabel: t.brandName,
    iconUrl: brandIconUrl(t.brandCode),
  }));
}

function claimBrandSelectOptions(claims: AccBrandErpConfigRow[]) {
  return claims.map((c) => ({
    value: c.brandCode,
    label: c.brandCode,
    subLabel: c.brandName,
    iconUrl: brandIconUrl(c.brandCode, c.brandLogo),
  }));
}

function isClaimRowConfigured(draft: BrandDraft): boolean {
  return !!(
    draft.glAccountNo.trim()
    && draft.erpDescription.trim()
    && draft.bankAccountNo.trim()
    && draft.branchCode.trim()
  );
}

function findTarget(
  targetBrands: AccErpTargetBrandOption[],
  code: string,
): AccErpTargetBrandOption | undefined {
  if (!code) return undefined;
  return targetBrands.find((t) => t.brandCode.toUpperCase() === code.toUpperCase());
}

function pickText(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return null;
}

function resolveBcProfile(
  row: AccBrandErpConfigRow,
  targetBrands: AccErpTargetBrandOption[],
  selectedTarget: string,
): AccErpTargetBrandOption | undefined {
  const key = selectedTarget.trim().toUpperCase();
  if (!key) return undefined;

  const catalog = findTarget(targetBrands, key);
  const rowMatches = row.interfaceBrandCode?.toUpperCase() === key;

  if (catalog) {
    if (!rowMatches) return catalog;
    return {
      brandCode: catalog.brandCode,
      brandName: catalog.brandName,
      bcId: pickText(catalog.bcId, row.bcId),
      bcName: pickText(catalog.bcName, row.bcName),
      bcConnectionCode: pickText(catalog.bcConnectionCode, row.bcConnectionCode),
      bcConnectionName: pickText(catalog.bcConnectionName, row.bcConnectionName),
      bcProfileComplete: catalog.bcProfileComplete || row.bcProfileComplete,
    };
  }

  if (rowMatches) {
    return {
      brandCode: key,
      brandName: row.interfaceBrandName ?? key,
      bcId: row.bcId,
      bcName: row.bcName,
      bcConnectionCode: row.bcConnectionCode,
      bcConnectionName: row.bcConnectionName,
      bcProfileComplete: row.bcProfileComplete,
    };
  }

  return undefined;
}

function primaryByBrand(rows: AccBrandAccountRow[]): Record<string, AccBrandAccountRow> {
  const map: Record<string, AccBrandAccountRow> = {};
  const sorted = Array.from(rows).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const r of sorted) {
    if (!r.isActive) continue;
    if (!map[r.brandCode.toUpperCase()]) map[r.brandCode.toUpperCase()] = r;
  }
  return map;
}

function primaryJournalBatchByBrand(rows: AccBrandJournalBatchRow[]): Record<string, AccBrandJournalBatchRow> {
  const map: Record<string, AccBrandJournalBatchRow> = {};
  const sorted = Array.from(rows).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const r of sorted) {
    if (!r.isActive) continue;
    if (!map[r.brandCode.toUpperCase()]) map[r.brandCode.toUpperCase()] = r;
  }
  return map;
}

function primaryBranchByBrand(rows: AccBrandBranchRow[]): Record<string, AccBrandBranchRow> {
  const map: Record<string, AccBrandBranchRow> = {};
  const sorted = Array.from(rows).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const r of sorted) {
    if (!r.isActive) continue;
    if (!map[r.brandCode.toUpperCase()]) map[r.brandCode.toUpperCase()] = r;
  }
  return map;
}

function draftFromMaps(
  claimBrandCode: string,
  journalBatchMap: Record<string, AccBrandJournalBatchRow>,
  glMap: Record<string, AccBrandAccountRow>,
  bankMap: Record<string, AccBrandAccountRow>,
  branchMap: Record<string, AccBrandBranchRow>,
  journalOverride?: { batchName: string; id?: number },
): BrandDraft {
  const key = claimBrandCode.toUpperCase();
  const journalBatch = journalOverride?.batchName
    ? { batchName: journalOverride.batchName, id: journalOverride.id }
    : journalBatchMap[key];
  const gl = glMap[key];
  const bank = bankMap[key];
  const branch = branchMap[key];
  return {
    journalBatchName: journalBatch?.batchName ?? journalOverride?.batchName ?? "",
    glAccountNo: gl?.accountNo ?? "",
    erpDescription: gl?.erpDescription?.trim() ?? gl?.displayName?.trim() ?? "",
    bankAccountNo: bank?.accountNo ?? "",
    branchCode: branch?.branchCode ?? "",
    deptAsBranch: branch?.deptAsBranch ?? false,
    fixedErpDeptCode: branch?.fixedErpDeptCode?.trim() ?? "",
    journalBatchId: journalOverride?.id ?? journalBatch?.id,
    glId: gl?.id,
    bankId: bank?.id,
    branchId: branch?.id,
  };
}

function claimAccountsEqual(a: BrandDraft, b: BrandDraft): boolean {
  return a.glAccountNo.trim() === b.glAccountNo.trim()
    && a.erpDescription.trim() === b.erpDescription.trim()
    && a.bankAccountNo.trim() === b.bankAccountNo.trim()
    && a.branchCode.trim() === b.branchCode.trim()
    && a.deptAsBranch === b.deptAsBranch
    && a.fixedErpDeptCode.trim() === b.fixedErpDeptCode.trim();
}

function draftsEqual(a: BrandDraft, b: BrandDraft): boolean {
  return a.journalBatchName.trim() === b.journalBatchName.trim()
    && a.glAccountNo.trim() === b.glAccountNo.trim()
    && a.erpDescription.trim() === b.erpDescription.trim()
    && a.bankAccountNo.trim() === b.bankAccountNo.trim()
    && a.branchCode.trim() === b.branchCode.trim()
    && a.deptAsBranch === b.deptAsBranch
    && a.fixedErpDeptCode.trim() === b.fixedErpDeptCode.trim();
}

function isBrandDirty(
  claimCode: string,
  targetByClaim: Record<string, string>,
  savedTargetByClaim: Record<string, string>,
  accountDrafts: Record<string, BrandDraft>,
  accountSaved: Record<string, BrandDraft>,
  journalBatchMap: Record<string, AccBrandJournalBatchRow>,
  glMap: Record<string, AccBrandAccountRow>,
  bankMap: Record<string, AccBrandAccountRow>,
  branchMap: Record<string, AccBrandBranchRow>,
): boolean {
  const target = targetByClaim[claimCode] ?? "";
  const savedTarget = savedTargetByClaim[claimCode] ?? "";
  if (target !== savedTarget) return true;
  const draft = accountDrafts[claimCode] ?? draftFromMaps(claimCode, journalBatchMap, glMap, bankMap, branchMap);
  const saved = accountSaved[claimCode] ?? draftFromMaps(claimCode, journalBatchMap, glMap, bankMap, branchMap);
  return !draftsEqual(draft, saved);
}

function validateBrandSave(
  claimCode: string,
  brandName: string,
  targetByClaim: Record<string, string>,
  savedTargetByClaim: Record<string, string>,
  accountDrafts: Record<string, BrandDraft>,
  accountSaved: Record<string, BrandDraft>,
  journalBatchMap: Record<string, AccBrandJournalBatchRow>,
  glMap: Record<string, AccBrandAccountRow>,
  bankMap: Record<string, AccBrandAccountRow>,
  branchMap: Record<string, AccBrandBranchRow>,
  erpByBrand: ErpAccountsByBrand,
): string | null {
  const target = targetByClaim[claimCode]?.trim() ?? "";
  const savedTarget = savedTargetByClaim[claimCode]?.trim() ?? "";
  const draft = accountDrafts[claimCode] ?? draftFromMaps(claimCode, journalBatchMap, glMap, bankMap, branchMap);
  const saved = accountSaved[claimCode] ?? draftFromMaps(claimCode, journalBatchMap, glMap, bankMap, branchMap);

  const targetDirty = target !== savedTarget;
  const journalDirty = draft.journalBatchName.trim() !== saved.journalBatchName.trim();
  const glDirty = draft.glAccountNo.trim() !== saved.glAccountNo.trim();
  const descDirty = draft.erpDescription.trim() !== saved.erpDescription.trim();
  const bankDirty = draft.bankAccountNo.trim() !== saved.bankAccountNo.trim();
  const branchDirty = isBranchConfigDirty(draft, saved);

  if (!targetDirty && !journalDirty && !glDirty && !descDirty && !bankDirty && !branchDirty) return null;

  if (targetDirty && !target) return `กรุณาเลือกแบรนด์ปลายทางสำหรับ ${brandName}`;
  if ((journalDirty || glDirty || descDirty || bankDirty || branchDirty) && !target) {
    return `กรุณาเลือกแบรนด์ปลายทางสำหรับ ${brandName} ก่อนบันทึกบัญชี`;
  }
  if (journalDirty && !draft.journalBatchName.trim()) return `กรุณาเลือก Journal Batch สำหรับ ${brandName}`;
  if (glDirty && !draft.glAccountNo.trim()) return `กรุณาเลือก G/L สำหรับ ${brandName}`;
  if ((glDirty || descDirty) && draft.glAccountNo.trim() && !draft.erpDescription.trim()) {
    return `กรุณาระบุ Description สำหรับ ${brandName}`;
  }
  if (bankDirty && !draft.bankAccountNo.trim()) return `กรุณาเลือก Bank สำหรับ ${brandName}`;
  if (branchDirty && !draft.branchCode.trim()) return `กรุณาเลือก Branch สำหรับ ${brandName}`;

  const deptError = validateDeptAsBranchForDraft(draft, target, erpByBrand, brandName);
  if (deptError) return deptError;

  return null;
}

function isRowComplete(
  selectedTarget: string,
  savedTarget: string,
  accountDraft: BrandDraft,
  accountSaved: BrandDraft,
): boolean {
  if (!selectedTarget || selectedTarget !== savedTarget) return false;
  if (!draftsEqual(accountDraft, accountSaved)) return false;
  return accountDraft.journalBatchName.trim() !== ""
    && accountDraft.glAccountNo.trim() !== ""
    && accountDraft.erpDescription.trim() !== ""
    && accountDraft.bankAccountNo.trim() !== ""
    && accountDraft.branchCode.trim() !== "";
}

function accountSelectOptions(
  items: ErpAccountOption[],
  current?: string,
): { value: string; label: string; subLabel?: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string; subLabel?: string }[] = [];
  for (const item of items) {
    if (seen.has(item.accountNo)) continue;
    seen.add(item.accountNo);
    const subLabel = item.displayName?.trim() && item.displayName.trim() !== item.accountNo
      ? item.displayName.trim()
      : undefined;
    out.push({ value: item.accountNo, label: item.accountNo, subLabel });
  }
  if (current && !seen.has(current)) {
    out.push({ value: current, label: current });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function resolveGlErpDescription(draft: BrandDraft, glItems: ErpAccountOption[]): string {
  if (draft.erpDescription.trim()) return draft.erpDescription.trim();
  return erpDescriptionFromGlOption(draft.glAccountNo, accountSelectOptions(glItems));
}

function journalBatchSelectOptions(
  items: ErpJournalBatchOption[],
  current?: string,
): { value: string; label: string; subLabel?: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string; subLabel?: string }[] = [];
  for (const item of items) {
    if (seen.has(item.batchName)) continue;
    seen.add(item.batchName);
    const subLabel = item.displayName?.trim() && item.displayName.trim() !== item.batchName
      ? item.displayName.trim()
      : item.templateName?.trim() || undefined;
    out.push({ value: item.batchName, label: item.batchName, subLabel });
  }
  if (current && !seen.has(current)) {
    out.push({ value: current, label: current });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function branchSelectOptions(
  items: ErpBranchOption[],
  current?: string,
): { value: string; label: string; subLabel?: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string; subLabel?: string }[] = [];
  for (const item of items) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    const subLabel = item.displayName?.trim() && item.displayName.trim() !== item.code
      ? item.displayName.trim()
      : undefined;
    out.push({ value: item.code, label: item.code, subLabel });
  }
  if (current && !seen.has(current)) {
    out.push({ value: current, label: current });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label
      className="block text-[10px] font-bold uppercase tracking-wide mb-1.5"
      style={{ color: "var(--text-faint)" }}
    >
      {children}
    </label>
  );
}

function SetupProgressChip({
  label,
  done,
  dirty,
  detail,
}: {
  label: string;
  done: boolean;
  dirty?: boolean;
  detail?: string;
}) {
  const Icon = done ? CheckCircle2 : Circle;
  const color = done
    ? "var(--text-info-green)"
    : dirty
      ? "var(--text-info-yellow)"
      : "var(--text-muted)";
  const bg = done
    ? "var(--bg-info-green)"
    : dirty
      ? "var(--bg-info-yellow)"
      : "var(--bg-card-alt)";
  const border = done
    ? "var(--border-info-green)"
    : dirty
      ? "var(--border-info-yellow)"
      : "var(--border-light)";

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium"
      style={{ background: bg, border: `1px solid ${border}`, color }}
    >
      <Icon size={13} className="shrink-0" />
      <span>{label}</span>
      {detail ? (
        <span className="font-bold" style={{ opacity: 0.85 }}>
          {detail}
        </span>
      ) : null}
    </span>
  );
}

const CLAIM_ACCOUNT_GRID = "minmax(168px,1.05fr) minmax(0,1fr) minmax(0,1.15fr) minmax(0,1fr) minmax(180px,1.5fr) 2.75rem";

function SettingsPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl overflow-hidden ${className}`}
      style={{
        background: "var(--bg-card-alt)",
        border: "1px solid var(--border-card)",
      }}
    >
      {children}
    </div>
  );
}

function SummaryRow({ label, value, align }: { label: string; value: string; align?: "left" | "right" }) {
  const empty = !value.trim() || value === "—";
  return (
    <div className={`min-w-0 ${align === "right" ? "sm:text-right" : ""}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <p
        className="text-[12px] m-0 truncate font-medium"
        style={{ color: empty ? "var(--text-muted)" : "var(--text-primary)" }}
        title={value}
      >
        {empty ? "—" : value}
      </p>
    </div>
  );
}

function CardStatusBadge({ complete, dirty }: { complete: boolean; dirty: boolean }) {
  if (complete) {
    return (
      <span
        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: "rgba(79, 163, 122, 0.15)", color: "var(--text-info-green)" }}
      >
        ครบแล้ว
      </span>
    );
  }
  if (dirty) {
    return (
      <span
        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
      >
        รอบันทึก
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
    >
      ยังไม่ครบ
    </span>
  );
}

function BcConnectionMeta({ preview }: { preview?: AccErpTargetBrandOption | null }) {
  const bcName = decodeBcName(preview?.bcName);
  const bcId = preview?.bcId?.trim() ?? "";
  const connectCode = preview?.bcConnectionCode?.trim() ?? "";
  const connectionName = preview?.bcConnectionName?.trim() ?? "";
  const line = [bcName, connectCode, connectionName].filter((v) => v && v !== "—").join(" · ");
  const title = [bcName, bcId, connectCode, connectionName].filter(Boolean).join(" · ");

  if (!line) {
    return <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>—</p>;
  }
  return (
    <p className="text-[11px] m-0 truncate" style={{ color: "var(--text-muted)" }} title={title}>
      {line}
    </p>
  );
}

function BrandErpEditForm({
  row,
  targetBrands,
  selectedTarget,
  savedTarget,
  accountDraft,
  accountSaved,
  journalBatchOptions,
  glOptions,
  bankOptions,
  branchOptions,
  journalBatchReady,
  erpReady,
  branchReady,
  disabled,
  onSelectTarget,
  onChangeAccounts,
  onRequestDeptPick,
  onClearDeptFix,
}: {
  row: AccBrandErpConfigRow;
  targetBrands: AccErpTargetBrandOption[];
  selectedTarget: string;
  savedTarget: string;
  accountDraft: BrandDraft;
  accountSaved: BrandDraft;
  journalBatchOptions: { value: string; label: string }[];
  glOptions: { value: string; label: string }[];
  bankOptions: { value: string; label: string }[];
  branchOptions: { value: string; label: string }[];
  journalBatchReady: boolean;
  erpReady: boolean;
  branchReady: boolean;
  disabled: boolean;
  onSelectTarget: (value: string) => void;
  onChangeAccounts: (patch: Partial<BrandDraft>) => void;
  onRequestDeptPick?: () => void;
  onClearDeptFix?: () => void;
}) {
  const preview = resolveBcProfile(row, targetBrands, selectedTarget);
  const targetChosen = selectedTarget !== "";
  const targetDirty = selectedTarget !== savedTarget;
  const journalDirty = accountDraft.journalBatchName.trim() !== accountSaved.journalBatchName.trim();
  const glDirty = accountDraft.glAccountNo.trim() !== accountSaved.glAccountNo.trim();
  const descDirty = accountDraft.erpDescription.trim() !== accountSaved.erpDescription.trim();
  const bankDirty = accountDraft.bankAccountNo.trim() !== accountSaved.bankAccountNo.trim();
  const branchDirty = isBranchConfigDirty(accountDraft, accountSaved);

  const targetOptions = useMemo(
    () => targetBrandSelectOptions(targetBrands),
    [targetBrands],
  );

  const accountsDisabled = disabled || !targetChosen || !erpReady;
  const journalBatchDisabled = disabled || !targetChosen || !journalBatchReady;
  const branchDisabled = disabled || !targetChosen || !branchReady;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="min-w-0" id="acc-erp-focus-claimTarget">
        <FieldLabel>ส่งเข้าแบรนด์</FieldLabel>
        <SearchableSelect
          value={selectedTarget}
          onChange={onSelectTarget}
          options={targetOptions}
          placeholder="— เลือกแบรนด์ —"
          emptyLabel="— เลือกแบรนด์ —"
          searchPlaceholder="ค้นหาแบรนด์..."
          triggerBackground="var(--bg-card)"
          disabled={disabled}
          borderColor={targetDirty ? "var(--border-info-yellow)" : undefined}
        />
      </div>
      <div className="min-w-0">
        <FieldLabel>BC Name</FieldLabel>
        <p
          className="text-[12px] m-0 px-3 py-2.5 rounded-xl min-h-[38px] flex items-center"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-input)",
            color: "var(--text-primary)",
          }}
          title={decodeBcName(preview?.bcName)}
        >
          {decodeBcName(preview?.bcName)}
        </p>
      </div>
      <div className="min-w-0" id={`acc-erp-focus-journalBatch-${row.brandCode}`}>
        <FieldLabel>Journal Batch</FieldLabel>
        <SearchableSelect
          value={accountDraft.journalBatchName}
          onChange={(v) => onChangeAccounts({ journalBatchName: v })}
          options={journalBatchOptions}
          placeholder={!targetChosen ? "เลือกแบรนด์ก่อน" : !journalBatchReady ? "Sync ERP ก่อน" : "— เลือก Journal Batch —"}
          emptyLabel={!targetChosen ? "เลือกแบรนด์ก่อน" : !journalBatchReady ? "Sync ERP ก่อน" : "— เลือก Journal Batch —"}
          searchPlaceholder="ค้นหา Journal Batch..."
          triggerBackground="var(--bg-card)"
          disabled={journalBatchDisabled}
          borderColor={journalDirty ? "var(--border-info-yellow)" : undefined}
        />
      </div>
      <div className="min-w-0" id={`acc-erp-focus-gl-${row.brandCode}`}>
        <FieldLabel>G/L Account</FieldLabel>
        <SearchableSelect
          value={accountDraft.glAccountNo}
          onChange={(v) => onChangeAccounts({
            glAccountNo: v,
            erpDescription: erpDescriptionFromGlOption(v, glOptions),
          })}
          options={glOptions}
          placeholder={!targetChosen ? "เลือกแบรนด์ก่อน" : !erpReady ? "Sync ERP ก่อน" : "— เลือก G/L —"}
          emptyLabel={!targetChosen ? "เลือกแบรนด์ก่อน" : !erpReady ? "Sync ERP ก่อน" : "— เลือก G/L —"}
          searchPlaceholder="ค้นหา G/L..."
          triggerBackground="var(--bg-card)"
          disabled={accountsDisabled}
          borderColor={glDirty ? "var(--border-info-yellow)" : undefined}
        />
      </div>
      <div className="min-w-0">
        <FieldLabel>Description</FieldLabel>
        <input
          type="text"
          value={accountDraft.erpDescription}
          onChange={(e) => onChangeAccounts({ erpDescription: e.target.value })}
          disabled={accountsDisabled || !accountDraft.glAccountNo.trim()}
          placeholder={!accountDraft.glAccountNo.trim() ? "เลือก G/L ก่อน" : "คำอธิบาย Journal"}
          maxLength={500}
          className="w-full text-[12px] rounded-xl px-3 py-2.5 outline-none min-h-[38px] disabled:opacity-50"
          style={{
            background: "var(--bg-card)",
            border: `1px solid ${descDirty ? "var(--border-info-yellow)" : "var(--border-input)"}`,
            color: accountDraft.erpDescription.trim() ? "var(--text-primary)" : "var(--text-muted)",
          }}
        />
      </div>
      <div className="min-w-0" id={`acc-erp-focus-bank-${row.brandCode}`}>
        <FieldLabel>Bank Account</FieldLabel>
        <SearchableSelect
          value={accountDraft.bankAccountNo}
          onChange={(v) => onChangeAccounts({ bankAccountNo: v })}
          options={bankOptions}
          placeholder={!targetChosen ? "เลือกแบรนด์ก่อน" : !erpReady ? "Sync ERP ก่อน" : "— เลือก Bank —"}
          emptyLabel={!targetChosen ? "เลือกแบรนด์ก่อน" : !erpReady ? "Sync ERP ก่อน" : "— เลือก Bank —"}
          searchPlaceholder="ค้นหา Bank..."
          triggerBackground="var(--bg-card)"
          disabled={accountsDisabled}
          borderColor={bankDirty ? "var(--border-info-yellow)" : undefined}
        />
      </div>
      <div className="min-w-0" id={`acc-erp-focus-branch-${row.brandCode}`}>
        <FieldLabel>Branch Code</FieldLabel>
        <SearchableSelect
          value={accountDraft.branchCode}
          onChange={(v) => onChangeAccounts({ branchCode: v })}
          options={branchOptions}
          placeholder={!targetChosen ? "เลือกแบรนด์ก่อน" : !branchReady ? "Sync ERP ก่อน" : "— เลือก Branch —"}
          emptyLabel={!targetChosen ? "เลือกแบรนด์ก่อน" : !branchReady ? "Sync ERP ก่อน" : "— เลือก Branch —"}
          searchPlaceholder="ค้นหา Branch..."
          triggerBackground="var(--bg-card)"
          wrapLabel
          disabled={branchDisabled}
          borderColor={branchDirty ? "var(--border-info-yellow)" : undefined}
        />
        <ErpDeptFixField
          deptAsBranch={accountDraft.deptAsBranch}
          fixedErpDeptCode={accountDraft.fixedErpDeptCode}
          branchCode={accountDraft.branchCode}
          disabled={branchDisabled}
          onRequestPick={() => onRequestDeptPick?.()}
          onClear={() => onClearDeptFix?.()}
        />
      </div>
    </div>
  );
}

function BrandErpSummaryCard({
  row,
  targetBrands,
  selectedTarget,
  savedTarget,
  accountDraft,
  accountSaved,
  disabled,
  onClick,
}: {
  row: AccBrandErpConfigRow;
  targetBrands: AccErpTargetBrandOption[];
  selectedTarget: string;
  savedTarget: string;
  accountDraft: BrandDraft;
  accountSaved: BrandDraft;
  disabled: boolean;
  onClick: () => void;
}) {
  const preview = resolveBcProfile(row, targetBrands, selectedTarget);
  const targetDirty = selectedTarget !== savedTarget;
  const accountsDirty = !draftsEqual(accountDraft, accountSaved);
  const isDirty = targetDirty || accountsDirty;
  const rowComplete = isRowComplete(selectedTarget, savedTarget, accountDraft, accountSaved);

  const cardBorder = rowComplete
    ? "var(--border-info-green)"
    : isDirty
      ? "var(--border-info-yellow)"
      : "var(--border-card)";

  const cardBg = rowComplete
    ? "var(--bg-info-green)"
    : isDirty
      ? "var(--bg-info-yellow)"
      : "var(--bg-card-alt)";

  const targetLabel = selectedTarget
    ? (() => {
      const t = findTarget(targetBrands, selectedTarget);
      return t ? `${t.brandCode} — ${t.brandName}` : selectedTarget;
    })()
    : "—";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left rounded-xl px-4 py-4 transition-all"
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        boxShadow: rowComplete ? "0 0 0 1px rgba(79, 163, 122, 0.08)" : undefined,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {row.brandLogo && (
            <img
              src={row.brandLogo}
              alt=""
              className="h-8 w-auto object-contain shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
              {row.brandName}
            </p>
            <p className="text-[10px] m-0 font-mono" style={{ color: "var(--text-muted)" }}>
              {row.brandCode}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CardStatusBadge complete={rowComplete} dirty={isDirty} />
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg"
            style={{ color: "var(--nav-active-text)", background: "var(--nav-active-bg)" }}
          >
            <Pencil size={12} />
            แก้ไข
          </span>
          <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
        </div>
      </div>

      <div
        className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 mt-2.5 pt-2.5"
        style={{ borderTop: "1px solid var(--border-light)" }}
      >
        <SummaryRow label="ส่งเข้าแบรนด์" value={targetLabel} />
        <SummaryRow label="BC Name" value={decodeBcName(preview?.bcName)} />
        <SummaryRow label="Journal Batch" value={accountDraft.journalBatchName} />
        <SummaryRow label="G/L Account" value={accountDraft.glAccountNo} />
        <SummaryRow label="Description" value={accountDraft.erpDescription} />
        <SummaryRow label="Bank Account" value={accountDraft.bankAccountNo} />
        <SummaryRow label="Branch Code" value={accountDraft.branchCode} />
      </div>
    </button>
  );
}

function ClaimBrandsSummary({ claims, compact }: { claims: AccBrandErpConfigRow[]; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-1" style={{ color: "var(--text-faint)" }}>
        แบรนด์เบิก
        {claims.length > 0 && (
          <span className="font-semibold normal-case tracking-normal ml-1" style={{ color: "var(--text-muted)" }}>
            ({claims.length})
          </span>
        )}
      </p>
      {claims.length === 0 ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>—</p>
      ) : (
        <div className={`flex flex-wrap items-center ${compact ? "gap-1" : "gap-1.5"}`}>
          {claims.map((claim) => (
            <span
              key={claim.brandCode}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium max-w-full"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-light)",
                color: "var(--text-secondary)",
              }}
              title={`${claim.brandName} (${claim.brandCode})`}
            >
              {claim.brandLogo && (
                <img
                  src={claim.brandLogo}
                  alt=""
                  className="h-3.5 w-auto object-contain shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <span className="truncate">{claim.brandName}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function isGroupComplete(
  group: TargetErpGroup,
  brands: AccBrandErpConfigRow[],
  targetByClaim: Record<string, string>,
  savedTargetByClaim: Record<string, string>,
  journalDraft: string,
  journalSaved: string,
  accountDrafts: Record<string, BrandDraft>,
  accountSaved: Record<string, BrandDraft>,
): boolean {
  const target = group.targetBrandCode;
  const members = groupMemberCodes(target, brands, targetByClaim);
  if (members.length === 0) return false;
  if (journalDraft.trim() !== journalSaved.trim() || !journalSaved.trim()) return false;
  for (const code of members) {
    const claimTarget = targetByClaim[code]?.trim() ?? "";
    const savedTarget = savedTargetByClaim[code]?.trim() ?? "";
    if (claimTarget.toUpperCase() !== target || claimTarget !== savedTarget) return false;
    const draft = accountDrafts[code];
    const saved = accountSaved[code];
    if (!draft || !saved || !claimAccountsEqual(draft, saved)) return false;
    if (!draft.glAccountNo.trim() || !draft.erpDescription.trim() || !draft.bankAccountNo.trim() || !draft.branchCode.trim()) return false;
  }
  return true;
}

function isGroupDirty(
  group: TargetErpGroup,
  brands: AccBrandErpConfigRow[],
  targetByClaim: Record<string, string>,
  savedTargetByClaim: Record<string, string>,
  journalDraft: string,
  journalSaved: string,
  accountDrafts: Record<string, BrandDraft>,
  accountSaved: Record<string, BrandDraft>,
): boolean {
  if (journalDraft.trim() !== journalSaved.trim()) return true;
  const currentMembers = groupMemberCodes(group.targetBrandCode, brands, targetByClaim).sort();
  const savedMembers = groupMemberCodes(group.targetBrandCode, brands, savedTargetByClaim).sort();
  if (currentMembers.join("|") !== savedMembers.join("|")) return true;
  for (const code of currentMembers) {
    const draft = accountDrafts[code];
    const saved = accountSaved[code];
    if (!draft || !saved || !claimAccountsEqual(draft, saved)) return true;
  }
  return false;
}

function TargetErpSummaryCard({
  group,
  brands,
  targetBrands,
  targetByClaim,
  savedTargetByClaim,
  journalDraft,
  journalSaved,
  accountDrafts,
  accountSaved,
  disabled,
  onClick,
}: {
  group: TargetErpGroup;
  brands: AccBrandErpConfigRow[];
  targetBrands: AccErpTargetBrandOption[];
  targetByClaim: Record<string, string>;
  savedTargetByClaim: Record<string, string>;
  journalDraft: string;
  journalSaved: string;
  accountDrafts: Record<string, BrandDraft>;
  accountSaved: Record<string, BrandDraft>;
  disabled: boolean;
  onClick: () => void;
}) {
  const preview = findTarget(targetBrands, group.targetBrandCode);
  const isDirty = isGroupDirty(
    group, brands, targetByClaim, savedTargetByClaim,
    journalDraft, journalSaved,
    accountDrafts, accountSaved,
  );
  const rowComplete = isGroupComplete(
    group, brands, targetByClaim, savedTargetByClaim, journalDraft, journalSaved, accountDrafts, accountSaved,
  );

  const cardBorder = rowComplete
    ? "var(--border-info-green)"
    : isDirty
      ? "var(--border-info-yellow)"
      : "var(--border-card)";

  const cardBg = rowComplete
    ? "var(--bg-info-green)"
    : isDirty
      ? "var(--bg-info-yellow)"
      : "var(--bg-card-alt)";

  const journalLabel = journalDraft.trim() || "—";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group w-full text-left rounded-xl px-4 py-3 transition-[box-shadow,border-color,transform] duration-200 hover:shadow-md active:scale-[0.998]"
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        boxShadow: rowComplete ? "0 0 0 1px rgba(79, 163, 122, 0.08)" : undefined,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            className="flex items-center justify-center shrink-0 rounded-lg p-1.5"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)" }}
          >
            <img
              src={group.targetBrandLogo}
              alt=""
              className="h-7 w-auto object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <p className="text-[14px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
              {group.targetBrandName}
            </p>
            <span
              className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0"
              style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
            >
              {group.targetBrandCode}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CardStatusBadge complete={rowComplete} dirty={isDirty} />
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg opacity-80 group-hover:opacity-100"
            style={{ color: "var(--nav-active-text)", background: "var(--nav-active-bg)" }}
          >
            <Pencil size={12} />
            แก้ไข
          </span>
          <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
        </div>
      </div>

      <div
        className="mt-2.5 pt-2.5 flex flex-col gap-2"
        style={{ borderTop: "1px solid var(--border-light)" }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-5 gap-y-2 items-end">
          <ClaimBrandsSummary claims={group.claimRows} compact />
          <SummaryRow label="Journal Batch" value={journalLabel} align="right" />
        </div>
        <BcConnectionMeta preview={preview} />
      </div>
    </button>
  );
}

function TargetErpGroupEditForm({
  group,
  targetBrands,
  journalDraft,
  journalSaved,
  accountDrafts,
  accountSaved,
  availableClaimsToAdd,
  journalBatchOptions,
  glOptions,
  bankOptions,
  branchOptions,
  journalBatchReady,
  erpReady,
  branchReady,
  disabled,
  onChangeJournal,
  onChangeClaimAccounts,
  onAddClaim,
  onRemoveClaim,
  onRequestDeptPick,
  onClearDeptFix,
}: {
  group: TargetErpGroup;
  targetBrands: AccErpTargetBrandOption[];
  journalDraft: string;
  journalSaved: string;
  accountDrafts: Record<string, BrandDraft>;
  accountSaved: Record<string, BrandDraft>;
  availableClaimsToAdd: AccBrandErpConfigRow[];
  journalBatchOptions: { value: string; label: string; subLabel?: string }[];
  glOptions: { value: string; label: string; subLabel?: string }[];
  bankOptions: { value: string; label: string; subLabel?: string }[];
  branchOptions: { value: string; label: string; subLabel?: string }[];
  journalBatchReady: boolean;
  erpReady: boolean;
  branchReady: boolean;
  disabled: boolean;
  onChangeJournal: (batchName: string) => void;
  onChangeClaimAccounts: (claimCode: string, patch: Partial<BrandDraft>) => void;
  onAddClaim: (claimCode: string) => void;
  onRemoveClaim: (claimCode: string) => void;
  onRequestDeptPick: (claimCode: string, branchCode: string) => void;
  onClearDeptFix: (claimCode: string) => void;
}) {
  const [addClaimCode, setAddClaimCode] = useState("");
  const preview = findTarget(targetBrands, group.targetBrandCode);
  const journalDirty = journalDraft.trim() !== journalSaved.trim();

  const addClaimOptions = useMemo(
    () => claimBrandSelectOptions(availableClaimsToAdd),
    [availableClaimsToAdd],
  );

  const accountsDisabled = disabled || !erpReady;
  const journalBatchDisabled = disabled || !journalBatchReady;
  const branchDisabled = disabled || !branchReady;

  const glPlaceholder = !erpReady ? "Sync ERP ก่อน" : "เลือก G/L";
  const bankPlaceholder = !erpReady ? "Sync ERP ก่อน" : "เลือก Bank";
  const branchPlaceholder = !branchReady ? "Sync ERP ก่อน" : "เลือก Branch";
  const journalPlaceholder = !journalBatchReady ? "Sync ERP ก่อน" : "เลือก Journal Batch";

  const configuredClaimCount = group.claimRows.filter((row) => {
    const draft = accountDrafts[row.brandCode];
    return draft ? isClaimRowConfigured(draft) : false;
  }).length;
  const journalOk = !!journalDraft.trim();

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>
            ตั้งค่าร่วมกลุ่ม
          </p>
          <div className="flex flex-wrap gap-2">
            <SetupProgressChip label="Journal Batch" done={journalOk} dirty={journalDirty} />
            <SetupProgressChip
              label="บัญชีแบรนด์เบิก"
              done={group.claimRows.length > 0 && configuredClaimCount === group.claimRows.length}
              detail={group.claimRows.length > 0 ? `${configuredClaimCount}/${group.claimRows.length}` : undefined}
            />
          </div>
        </div>

        <div className="min-w-0" id="acc-erp-focus-journalBatch">
          <FieldLabel>Journal Batch</FieldLabel>
          <SearchableSelect
            value={journalDraft}
            onChange={onChangeJournal}
            options={journalBatchOptions}
            placeholder={journalPlaceholder}
            emptyLabel={journalPlaceholder}
            searchPlaceholder="ค้นหา Journal Batch..."
            triggerBackground="var(--bg-card)"
            disabled={journalBatchDisabled}
            borderColor={journalDirty ? "var(--border-info-yellow)" : undefined}
          />
          <p className="text-[10px] m-0 mt-1.5" style={{ color: "var(--text-faint)" }}>
            ใช้ร่วมทุกแบรนด์เบิกในกลุ่มนี้
          </p>
        </div>

        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-light)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-faint)" }}>
            การเชื่อมต่อ BC
          </p>
          <BcConnectionMeta preview={preview} />
        </div>

        {!preview?.bcProfileComplete && (
          <p
            className="text-[11px] m-0 mt-3 px-3 py-2 rounded-lg"
            style={{
              background: "var(--bg-info-yellow)",
              color: "var(--text-info-yellow)",
              border: "1px solid var(--border-info-yellow)",
            }}
          >
            ตั้งค่า BC ใน Settings → Brand Config ให้ครบก่อน Sync ERP
          </p>
        )}
      </SettingsPanel>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>
              บัญชีแยกตามแบรนด์เบิก
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              G/L · Description · Bank · Branch ตั้งแยกต่อแบรนด์
            </p>
          </div>
          <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
            {group.claimRows.length} แบรนด์
          </span>
        </div>

        <SettingsPanel>
          <div
            className="hidden lg:grid items-end gap-3 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide"
            style={{
              color: "var(--text-faint)",
              gridTemplateColumns: CLAIM_ACCOUNT_GRID,
              background: "var(--bg-card)",
              borderBottom: "1px solid var(--border-light)",
            }}
          >
            <span>แบรนด์เบิก</span>
            <span>G/L Account</span>
            <span>Description</span>
            <span>Bank Account</span>
            <span>Branch Code</span>
            <span className="sr-only">ลบ</span>
          </div>

          {group.claimRows.length === 0 ? (
            <p
              className="text-[12px] m-0 px-4 py-8 text-center"
              style={{ color: "var(--text-muted)" }}
            >
              ยังไม่มีแบรนด์เบิก — เพิ่มจากด้านล่าง
            </p>
          ) : (
            <div className="flex flex-col">
              {group.claimRows.map((row, index) => {
                const draft = accountDrafts[row.brandCode] ?? {
                  journalBatchName: "", glAccountNo: "", erpDescription: "", bankAccountNo: "", branchCode: "", deptAsBranch: false, fixedErpDeptCode: "",
                };
                const saved = accountSaved[row.brandCode] ?? draft;
                const glDirty = draft.glAccountNo.trim() !== saved.glAccountNo.trim();
                const descDirty = draft.erpDescription.trim() !== saved.erpDescription.trim();
                const bankDirty = draft.bankAccountNo.trim() !== saved.bankAccountNo.trim();
                const branchDirty = isBranchConfigDirty(draft, saved);
                const rowDirty = glDirty || descDirty || bankDirty || branchDirty;
                const rowConfigured = isClaimRowConfigured(draft);
                const descDisabled = accountsDisabled || !draft.glAccountNo.trim();

                return (
                  <div
                    key={row.brandCode}
                    style={{
                      borderBottom: index < group.claimRows.length - 1 ? "1px solid var(--border-light)" : undefined,
                      background: rowDirty ? "var(--bg-info-yellow)" : undefined,
                    }}
                  >
                    {/* Mobile / tablet */}
                    <div className="lg:hidden p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <ClaimBrandCell row={row} configured={rowConfigured} />
                        <button
                          type="button"
                          onClick={() => onRemoveClaim(row.brandCode)}
                          disabled={disabled}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg shrink-0"
                          style={{
                            color: "var(--text-muted)",
                            border: "1px solid var(--border-light)",
                            background: "var(--bg-card)",
                          }}
                          title={`นำ ${row.brandName} ออกจากกลุ่ม`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <AccountField label="G/L Account" dirty={glDirty} focusId={`acc-erp-focus-gl-${row.brandCode}`}>
                        <SearchableSelect
                          value={draft.glAccountNo}
                          onChange={(v) => onChangeClaimAccounts(row.brandCode, {
                            glAccountNo: v,
                            erpDescription: erpDescriptionFromGlOption(v, glOptions),
                          })}
                          options={glOptions}
                          placeholder={glPlaceholder}
                          emptyLabel={glPlaceholder}
                          searchPlaceholder="ค้นหา G/L..."
                          triggerBackground="var(--bg-card)"
                          disabled={accountsDisabled}
                          borderColor={glDirty ? "var(--border-info-yellow)" : undefined}
                        />
                      </AccountField>
                      <AccountField label="Description" dirty={descDirty}>
                        <input
                          type="text"
                          value={draft.erpDescription}
                          onChange={(e) => onChangeClaimAccounts(row.brandCode, { erpDescription: e.target.value })}
                          disabled={descDisabled}
                          placeholder={!draft.glAccountNo.trim() ? "เลือก G/L ก่อน" : "คำอธิบาย Journal"}
                          maxLength={500}
                          className="w-full text-[12px] rounded-xl px-3 py-2.5 outline-none min-h-[38px] disabled:opacity-50"
                          style={{
                            background: "var(--bg-card)",
                            border: `1px solid ${descDirty ? "var(--border-info-yellow)" : "var(--border-input)"}`,
                            color: draft.erpDescription.trim() ? "var(--text-primary)" : "var(--text-muted)",
                          }}
                        />
                      </AccountField>
                      <AccountField label="Bank Account" dirty={bankDirty} focusId={`acc-erp-focus-bank-${row.brandCode}`}>
                        <SearchableSelect
                          value={draft.bankAccountNo}
                          onChange={(v) => onChangeClaimAccounts(row.brandCode, { bankAccountNo: v })}
                          options={bankOptions}
                          placeholder={bankPlaceholder}
                          emptyLabel={bankPlaceholder}
                          searchPlaceholder="ค้นหา Bank..."
                          triggerBackground="var(--bg-card)"
                          disabled={accountsDisabled}
                          borderColor={bankDirty ? "var(--border-info-yellow)" : undefined}
                        />
                      </AccountField>
                      <AccountField label="Branch Code" dirty={branchDirty} focusId={`acc-erp-focus-branch-${row.brandCode}`}>
                        <SearchableSelect
                          value={draft.branchCode}
                          onChange={(v) => onChangeClaimAccounts(row.brandCode, { branchCode: v })}
                          options={branchOptions}
                          placeholder={branchPlaceholder}
                          emptyLabel={branchPlaceholder}
                          searchPlaceholder="ค้นหา Branch..."
                          triggerBackground="var(--bg-card)"
                          wrapLabel
                          disabled={branchDisabled}
                          borderColor={branchDirty ? "var(--border-info-yellow)" : undefined}
                        />
                        <ErpDeptFixField
                          deptAsBranch={draft.deptAsBranch}
                          fixedErpDeptCode={draft.fixedErpDeptCode}
                          branchCode={draft.branchCode}
                          disabled={branchDisabled}
                          onRequestPick={() => onRequestDeptPick(row.brandCode, draft.branchCode)}
                          onClear={() => onClearDeptFix(row.brandCode)}
                        />
                      </AccountField>
                    </div>

                    {/* Desktop */}
                    <div
                      className="hidden lg:grid items-start gap-3 px-3 py-3"
                      style={{ gridTemplateColumns: CLAIM_ACCOUNT_GRID }}
                    >
                      <ClaimBrandCell row={row} configured={rowConfigured} />
                      <div id={`acc-erp-focus-gl-${row.brandCode}`}>
                        <SearchableSelect
                          value={draft.glAccountNo}
                          onChange={(v) => onChangeClaimAccounts(row.brandCode, {
                            glAccountNo: v,
                            erpDescription: erpDescriptionFromGlOption(v, glOptions),
                          })}
                          options={glOptions}
                          placeholder={glPlaceholder}
                          emptyLabel={glPlaceholder}
                          searchPlaceholder="ค้นหา G/L..."
                          triggerBackground="var(--bg-card)"
                          disabled={accountsDisabled}
                          borderColor={glDirty ? "var(--border-info-yellow)" : undefined}
                        />
                      </div>
                      <input
                        type="text"
                        value={draft.erpDescription}
                        onChange={(e) => onChangeClaimAccounts(row.brandCode, { erpDescription: e.target.value })}
                        disabled={descDisabled}
                        placeholder={!draft.glAccountNo.trim() ? "เลือก G/L ก่อน" : "คำอธิบาย Journal"}
                        maxLength={500}
                        className="w-full text-[12px] rounded-xl px-3 py-2.5 outline-none min-h-[38px] disabled:opacity-50 mt-1"
                        style={{
                          background: "var(--bg-card)",
                          border: `1px solid ${descDirty ? "var(--border-info-yellow)" : "var(--border-input)"}`,
                          color: draft.erpDescription.trim() ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      />
                      <div id={`acc-erp-focus-bank-${row.brandCode}`}>
                        <SearchableSelect
                          value={draft.bankAccountNo}
                          onChange={(v) => onChangeClaimAccounts(row.brandCode, { bankAccountNo: v })}
                          options={bankOptions}
                          placeholder={bankPlaceholder}
                          emptyLabel={bankPlaceholder}
                          searchPlaceholder="ค้นหา Bank..."
                          triggerBackground="var(--bg-card)"
                          disabled={accountsDisabled}
                          borderColor={bankDirty ? "var(--border-info-yellow)" : undefined}
                        />
                      </div>
                      <div id={`acc-erp-focus-branch-${row.brandCode}`}>
                        <SearchableSelect
                          value={draft.branchCode}
                          onChange={(v) => onChangeClaimAccounts(row.brandCode, { branchCode: v })}
                          options={branchOptions}
                          placeholder={branchPlaceholder}
                          emptyLabel={branchPlaceholder}
                          searchPlaceholder="ค้นหา Branch..."
                          triggerBackground="var(--bg-card)"
                          wrapLabel
                          disabled={branchDisabled}
                          borderColor={branchDirty ? "var(--border-info-yellow)" : undefined}
                        />
                        <ErpDeptFixField
                          deptAsBranch={draft.deptAsBranch}
                          fixedErpDeptCode={draft.fixedErpDeptCode}
                          branchCode={draft.branchCode}
                          disabled={branchDisabled}
                          onRequestPick={() => onRequestDeptPick(row.brandCode, draft.branchCode)}
                          onClear={() => onClearDeptFix(row.brandCode)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveClaim(row.brandCode)}
                        disabled={disabled}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg mx-auto mt-1 transition-colors hover:opacity-80"
                        style={{
                          color: "var(--text-muted)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-card)",
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.5 : 1,
                        }}
                        title={`นำ ${row.brandName} ออกจากกลุ่ม`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div
            className="px-3 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5"
            style={{
              borderTop: "1px dashed var(--border-light)",
              background: "var(--bg-card)",
            }}
          >
            <div className="flex items-center gap-1.5 shrink-0 sm:min-w-[7.5rem]">
              <Plus size={14} style={{ color: "var(--nav-active-text)" }} />
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                เพิ่มแบรนด์
              </span>
            </div>
            <div className="flex flex-1 min-w-0 items-center gap-2">
              <div className="flex-1 min-w-0">
                <SearchableSelect
                  value={addClaimCode}
                  onChange={setAddClaimCode}
                  options={addClaimOptions}
                  placeholder={addClaimOptions.length === 0 ? "ไม่มีแบรนด์ว่าง" : "เลือกแบรนด์เบิก..."}
                  emptyLabel={addClaimOptions.length === 0 ? "ไม่มีแบรนด์ว่าง" : "เลือกแบรนด์เบิก..."}
                  searchPlaceholder="ค้นหาแบรนด์..."
                  triggerBackground="var(--bg-card-alt)"
                  disabled={disabled || addClaimOptions.length === 0}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                disabled={disabled || !addClaimCode}
                onClick={() => {
                  if (!addClaimCode) return;
                  onAddClaim(addClaimCode);
                  setAddClaimCode("");
                }}
              >
                เพิ่ม
              </Button>
            </div>
          </div>
        </SettingsPanel>

        {addClaimOptions.length === 0 && group.claimRows.length > 0 && (
          <p className="text-[10px] m-0 mt-1.5" style={{ color: "var(--text-faint)" }}>
            แบรนด์ที่ยังไม่ได้อยู่ในกลุ่มอื่นจะแสดงในรายการเพิ่ม
          </p>
        )}
      </div>
    </div>
  );
}

function ClaimBrandCell({ row, configured }: { row: AccBrandErpConfigRow; configured?: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {row.brandLogo ? (
        <img
          src={row.brandLogo}
          alt=""
          className="h-8 w-8 object-contain shrink-0 rounded-md p-0.5"
          style={{ background: "var(--bg-card)" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <span
          className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-[9px] font-bold"
          style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}
        >
          {row.brandCode.slice(0, 2)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[12px] font-semibold m-0 truncate leading-tight" style={{ color: "var(--text-heading)" }}>
            {row.brandName}
          </p>
          {configured != null && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{
                background: configured ? "rgba(79, 163, 122, 0.15)" : "var(--bg-badge)",
                color: configured ? "var(--text-info-green)" : "var(--text-muted)",
              }}
            >
              {configured ? "ครบ" : "รอตั้งค่า"}
            </span>
          )}
        </div>
        <p className="text-[10px] m-0 font-mono leading-tight mt-0.5" style={{ color: "var(--text-faint)" }}>
          {row.brandCode}
        </p>
      </div>
    </div>
  );
}

function ErpDeptFixField({
  deptAsBranch,
  fixedErpDeptCode,
  branchCode,
  disabled,
  onRequestPick,
  onClear,
}: {
  deptAsBranch: boolean;
  fixedErpDeptCode: string;
  branchCode: string;
  disabled?: boolean;
  onRequestPick: () => void;
  onClear: () => void;
}) {
  const isActive = deptAsBranch && !!fixedErpDeptCode.trim();
  const pickDisabled = disabled || !branchCode.trim();
  const code = fixedErpDeptCode.trim();

  if (isActive) {
    return (
      <div
        className="mt-1.5 w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg"
        style={{
          background: "color-mix(in srgb, var(--text-info-green) 10%, var(--bg-card))",
          border: "1px solid color-mix(in srgb, var(--text-info-green) 28%, transparent)",
        }}
        title={`Journal ใช้ Dept: ${code}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GitBranch size={11} className="shrink-0" style={{ color: "var(--text-info-green)" }} />
          <span
            className="text-[9px] font-bold uppercase tracking-wide shrink-0"
            style={{ color: "var(--text-info-green)" }}
          >
            Fix
          </span>
          <span
            className="font-mono text-[11px] font-semibold leading-none"
            style={{ color: "var(--text-primary)" }}
          >
            {code}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onRequestPick}
            disabled={pickDisabled}
            title="เปลี่ยน Dept"
            className="inline-flex items-center justify-center h-6 w-6 rounded-md transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              color: "var(--text-secondary)",
              border: "1px solid color-mix(in srgb, var(--text-info-green) 25%, var(--border-light))",
              background: "var(--bg-card)",
            }}
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            title="ยกเลิก Fix Dept"
            className="inline-flex items-center justify-center h-6 w-6 rounded-md transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              color: "var(--text-muted)",
              border: "1px solid color-mix(in srgb, var(--text-info-green) 25%, var(--border-light))",
              background: "var(--bg-card)",
            }}
          >
            <X size={11} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onRequestPick}
      disabled={pickDisabled}
      title={pickDisabled && !branchCode.trim() ? "เลือก Branch ก่อน" : "เลือก Dept ERP ที่ต้องการ Fix"}
      className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-opacity hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed"
      style={{
        border: "1px dashed color-mix(in srgb, var(--border-input) 85%, transparent)",
        background: "color-mix(in srgb, var(--bg-card) 60%, transparent)",
        color: "var(--text-muted)",
      }}
    >
      <Plus size={11} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      <span>Fix Dept</span>
    </button>
  );
}

function AccountField({
  label,
  dirty,
  children,
  focusId,
}: {
  label: string;
  dirty?: boolean;
  children: ReactNode;
  focusId?: string;
}) {
  return (
    <div className="min-w-0" id={focusId}>
      <p
        className="text-[10px] font-semibold m-0 mb-1"
        style={{ color: dirty ? "var(--text-info-yellow)" : "var(--text-faint)" }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

export function BrandErpInterfaceSettings() {
  const { data, mutate, isLoading } = useSWR<{ ok: boolean; data?: PageData; error?: string }>(
    "/api/request/accounting/settings/erp-config",
    fetcher,
  );
  const { data: glData, mutate: mutateGl, isLoading: glLoading } = useSWR<{ ok: boolean; data: AccBrandAccountRow[] }>(
    "/api/request/accounting/settings/gl-accounts",
    fetcher,
  );
  const { data: bankData, mutate: mutateBank, isLoading: bankLoading } = useSWR<{ ok: boolean; data: AccBrandAccountRow[] }>(
    "/api/request/accounting/settings/bank-accounts",
    fetcher,
  );
  const { data: journalBatchData, mutate: mutateJournalBatch, isLoading: journalBatchLoading } = useSWR<{
    ok: boolean;
    data: AccBrandJournalBatchRow[];
  }>("/api/request/accounting/settings/journal-batches", fetcher);
  const { data: branchData, mutate: mutateBranch, isLoading: branchLoading } = useSWR<{
    ok: boolean;
    data: AccBrandBranchRow[];
  }>("/api/request/accounting/settings/branch-codes", fetcher);
  const { data: erpData, mutate: mutateErp, isLoading: erpLoading } = useSWR<{
    ok: boolean;
    data: ErpAccountsByBrand;
  }>("/api/request/accounting/settings/erp-accounts", fetcher);

  const page = data?.data;
  const brands = useMemo(() => page?.brands ?? [], [page?.brands]);
  const targetBrands = useMemo(() => page?.targetBrands ?? [], [page?.targetBrands]);
  const erpByBrand = erpData?.data ?? {};

  const glMap = useMemo(() => primaryByBrand(glData?.data ?? []), [glData]);
  const bankMap = useMemo(() => primaryByBrand(bankData?.data ?? []), [bankData]);
  const journalBatchMap = useMemo(
    () => primaryJournalBatchByBrand(journalBatchData?.data ?? []),
    [journalBatchData],
  );
  const branchMap = useMemo(() => primaryBranchByBrand(branchData?.data ?? []), [branchData]);

  const [targetByClaim, setTargetByClaim] = useState<Record<string, string>>({});
  const [savedTargetByClaim, setSavedTargetByClaim] = useState<Record<string, string>>({});
  const [journalByTarget, setJournalByTarget] = useState<Record<string, string>>({});
  const [savedJournalByTarget, setSavedJournalByTarget] = useState<Record<string, string>>({});
  const [journalBatchIdByTarget, setJournalBatchIdByTarget] = useState<Record<string, number | undefined>>({});
  const [accountDrafts, setAccountDrafts] = useState<Record<string, BrandDraft>>({});
  const [accountSaved, setAccountSaved] = useState<Record<string, BrandDraft>>({});
  const [initialized, setInitialized] = useState(false);
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  const [editTargetCode, setEditTargetCode] = useState<string | null>(null);
  const [editUnassignedClaim, setEditUnassignedClaim] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  /**
   * The `erpInterface` grant opens every route on this tab except
   * `settings/erp-accounts/sync`, which writes the ERP reporting database shared
   * with the Rocks Fast sibling and so stayed admin-only. Hide the control
   * rather than offer it and answer 403. Same SWR key the settings page already
   * loaded, so this is a cache hit and nothing flashes.
   */
  const { isAdmin: canSyncErp } = useAccountingAccess();
  const [erpDeptPick, setErpDeptPick] = useState<{
    targetCode: string;
    branchCode: string;
    claimCode: string;
  } | null>(null);
  const [syncPhasesSelected, setSyncPhasesSelected] = useState(DEFAULT_SYNC_PHASES);
  const [syncPopup, setSyncPopup] = useState<ErpSyncPopupState>({
    open: false,
    brandCode: "",
    part: "",
    percent: 0,
    status: "running",
  });

  const syncStateFromServer = useCallback(() => {
    const nextTargets: Record<string, string> = {};
    const nextDrafts: Record<string, BrandDraft> = {};
    const nextSaved: Record<string, BrandDraft> = {};
    const nextJournal: Record<string, string> = {};
    const nextSavedJournal: Record<string, string> = {};
    const nextJournalIds: Record<string, number | undefined> = {};

    for (const b of brands) {
      nextTargets[b.brandCode] = b.interfaceBrandCode ?? "";
    }

    const { groups, unassigned } = buildAllTargetErpGroups(brands, nextTargets, targetBrands);

    for (const g of groups) {
      const legacyCodes = claimCodesForGroup(g);
      const journal = resolveJournalForTarget(g.targetBrandCode, legacyCodes, journalBatchMap);
      nextJournal[g.targetBrandCode] = journal.batchName;
      nextSavedJournal[g.targetBrandCode] = journal.batchName;
      nextJournalIds[g.targetBrandCode] = journal.id;
      for (const row of g.claimRows) {
        const d = draftFromMaps(row.brandCode, journalBatchMap, glMap, bankMap, branchMap, journal);
        nextDrafts[row.brandCode] = d;
        nextSaved[row.brandCode] = { ...d };
      }
    }

    for (const row of unassigned) {
      const d = draftFromMaps(row.brandCode, journalBatchMap, glMap, bankMap, branchMap);
      nextDrafts[row.brandCode] = d;
      nextSaved[row.brandCode] = { ...d };
    }

    setTargetByClaim(nextTargets);
    setSavedTargetByClaim({ ...nextTargets });
    setJournalByTarget(nextJournal);
    setSavedJournalByTarget(nextSavedJournal);
    setJournalBatchIdByTarget(nextJournalIds);
    setAccountDrafts(nextDrafts);
    setAccountSaved(nextSaved);
  }, [brands, targetBrands, journalBatchMap, glMap, bankMap, branchMap]);

  useEffect(() => {
    if (brands.length === 0 || initialized) return;
    syncStateFromServer();
    setInitialized(true);
  }, [brands, initialized, syncStateFromServer]);

  const { groups: targetGroups, unassigned: unassignedBrands } = useMemo(
    () => buildAllTargetErpGroups(brands, targetByClaim, targetBrands),
    [brands, targetByClaim, targetBrands],
  );

  const completeCount = useMemo(
    () => brands.filter((b) => {
      const target = targetByClaim[b.brandCode] ?? "";
      const savedTarget = savedTargetByClaim[b.brandCode] ?? "";
      const targetKey = target.toUpperCase();
      const journalName = targetKey ? (journalByTarget[targetKey] ?? "") : "";
      const savedJournal = targetKey ? (savedJournalByTarget[targetKey] ?? "") : "";
      const baseDraft = accountDrafts[b.brandCode] ?? draftFromMaps(b.brandCode, journalBatchMap, glMap, bankMap, branchMap);
      const baseSaved = accountSaved[b.brandCode] ?? draftFromMaps(b.brandCode, journalBatchMap, glMap, bankMap, branchMap);
      const draft = { ...baseDraft, journalBatchName: journalName };
      const saved = { ...baseSaved, journalBatchName: savedJournal };
      return isRowComplete(target, savedTarget, draft, saved);
    }).length,
    [brands, targetByClaim, savedTargetByClaim, journalByTarget, savedJournalByTarget, accountDrafts, accountSaved, journalBatchMap, glMap, bankMap, branchMap],
  );

  const activeSyncPhases = useMemo(
    () => SYNC_PHASES.filter((p) => syncPhasesSelected[p.phase]),
    [syncPhasesSelected],
  );

  const allSyncSelected = activeSyncPhases.length === SYNC_PHASES.length;
  const someSyncSelected = activeSyncPhases.length > 0 && !allSyncSelected;

  const setAllSyncPhases = (selected: boolean) => {
    setSyncPhasesSelected({
      journalBatch: selected,
      gl: selected,
      bank: selected,
      branch: selected,
    });
  };

  const openClaimSettings = useCallback((claim: string) => {
    const row = brands.find((b) => b.brandCode === claim);
    const target = row?.interfaceBrandCode?.trim().toUpperCase();
    if (target) setEditTargetCode(target);
    else setEditUnassignedClaim(claim);
  }, [brands]);

  useAccSettingsDeepLink({
    ready: initialized,
    onOpenInterfaceGroup: (iface) => setEditTargetCode(iface),
    onOpenUnassignedClaim: openClaimSettings,
  });

  const syncErp = async () => {
    if (activeSyncPhases.length === 0) {
      toast.error("กรุณาเลือกอย่างน้อย 1 รายการที่ต้องการ Sync");
      return;
    }

    const totalSteps = ERP_INTERFACE_BRANDS.length * activeSyncPhases.length;
    let doneSteps = 0;
    let totalRows = 0;
    const errors: string[] = [];

    setSyncing(true);
    setSyncPopup({
      open: true,
      brandCode: "",
      part: "เตรียมข้อมูล",
      percent: 0,
      status: "running",
    });

    const updateProgress = (brandCode: string, part: string) => {
      const percent = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
      setSyncPopup({
        open: true,
        brandCode,
        part,
        percent,
        status: "running",
      });
    };

    try {
      for (const brand of ERP_INTERFACE_BRANDS) {
        for (const { phase, label } of activeSyncPhases) {
          updateProgress(brand.id, label);
          try {
            const res = await fetch("/api/request/accounting/settings/erp-accounts/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ brandCode: brand.id, phase }),
            });
            const json = await res.json();
            if (!json.ok) {
              errors.push(`${brand.id} (${label}): ${json.error ?? "Sync failed"}`);
            } else {
              totalRows += (json.data?.glRows ?? 0)
                + (json.data?.bankRows ?? 0)
                + (json.data?.branchRows ?? 0)
                + (json.data?.journalBatchRows ?? 0);
            }
          } catch {
            errors.push(`${brand.id} (${label}): Sync failed`);
          }
          doneSteps += 1;
          setSyncPopup({
            open: true,
            brandCode: brand.id,
            part: label,
            percent: Math.round((doneSteps / totalSteps) * 100),
            status: "running",
          });
        }
      }

      await mutateErp();

      if (errors.length > 0) {
        setSyncPopup({
          open: true,
          brandCode: "",
          part: "",
          percent: 100,
          status: "error",
          detail: errors.slice(0, 3).join(" · "),
        });
        toast.warning(`Sync บางรายการไม่สำเร็จ (${errors.length}) — ดึงได้ ${totalRows} รายการ`);
      } else {
        setSyncPopup({
          open: true,
          brandCode: "",
          part: "",
          percent: 100,
          status: "done",
          detail: `ดึงข้อมูลสำเร็จ ${totalRows} รายการ — ${activeSyncPhases.map((p) => p.label).join(", ")}`,
        });
        toast.success(`Sync ERP สำเร็จ — ${totalRows} รายการ`);
      }

      window.setTimeout(() => {
        setSyncPopup((prev) => ({ ...prev, open: false }));
      }, errors.length > 0 ? 3500 : 1800);
    } catch {
      setSyncPopup({
        open: true,
        brandCode: "",
        part: "",
        percent: 0,
        status: "error",
        detail: "Sync ERP ไม่สำเร็จ",
      });
      toast.error("Sync ERP ไม่สำเร็จ");
      window.setTimeout(() => {
        setSyncPopup((prev) => ({ ...prev, open: false }));
      }, 2500);
    } finally {
      setSyncing(false);
    }
  };

  const refreshBrandAfterSave = useCallback(async (claimBrandCode: string) => {
    await Promise.all([mutate(), mutateGl(), mutateBank(), mutateJournalBatch(), mutateBranch()]);

    const [glListJson, bankListJson, journalListJson, branchListJson, erpConfigJson] = await Promise.all([
      fetch("/api/request/accounting/settings/gl-accounts").then((r) => r.json()),
      fetch("/api/request/accounting/settings/bank-accounts").then((r) => r.json()),
      fetch("/api/request/accounting/settings/journal-batches").then((r) => r.json()),
      fetch("/api/request/accounting/settings/branch-codes").then((r) => r.json()),
      fetch("/api/request/accounting/settings/erp-config").then((r) => r.json()),
    ]);

    const freshGl = primaryByBrand((glListJson.data ?? []) as AccBrandAccountRow[]);
    const freshBank = primaryByBrand((bankListJson.data ?? []) as AccBrandAccountRow[]);
    const freshJournal = primaryJournalBatchByBrand((journalListJson.data ?? []) as AccBrandJournalBatchRow[]);
    const freshBranch = primaryBranchByBrand((branchListJson.data ?? []) as AccBrandBranchRow[]);
    const synced = draftFromMaps(claimBrandCode, freshJournal, freshGl, freshBank, freshBranch);

    setAccountSaved((prev) => ({ ...prev, [claimBrandCode]: synced }));
    setAccountDrafts((prev) => ({ ...prev, [claimBrandCode]: { ...synced } }));

    const configRow = ((erpConfigJson.data?.brands ?? []) as AccBrandErpConfigRow[])
      .find((b) => b.brandCode === claimBrandCode);
    if (configRow) {
      const target = configRow.interfaceBrandCode ?? "";
      setSavedTargetByClaim((prev) => ({ ...prev, [claimBrandCode]: target }));
      setTargetByClaim((prev) => ({ ...prev, [claimBrandCode]: target }));
    }
  }, [mutate, mutateGl, mutateBank, mutateJournalBatch, mutateBranch]);

  const saveBrand = useCallback(async (
    claimBrandCode: string,
    options?: { quiet?: boolean },
  ): Promise<boolean> => {
    const b = brands.find((x) => x.brandCode === claimBrandCode);
    if (!b) return false;

    const validationError = validateBrandSave(
      claimBrandCode,
      b.brandName,
      targetByClaim,
      savedTargetByClaim,
      accountDrafts,
      accountSaved,
      journalBatchMap,
      glMap,
      bankMap,
      branchMap,
      erpByBrand,
    );
    if (validationError) {
      toast.error(validationError);
      return false;
    }

    if (!isBrandDirty(
      claimBrandCode,
      targetByClaim,
      savedTargetByClaim,
      accountDrafts,
      accountSaved,
      journalBatchMap,
      glMap,
      bankMap,
      branchMap,
    )) {
      return true;
    }

    const target = targetByClaim[claimBrandCode]?.trim() ?? "";
    const savedTarget = savedTargetByClaim[claimBrandCode]?.trim() ?? "";
    const draft = accountDrafts[claimBrandCode] ?? draftFromMaps(claimBrandCode, journalBatchMap, glMap, bankMap, branchMap);
    const saved = accountSaved[claimBrandCode] ?? draftFromMaps(claimBrandCode, journalBatchMap, glMap, bankMap, branchMap);

    const targetDirty = target !== savedTarget;
    const journalDirty = draft.journalBatchName.trim() !== saved.journalBatchName.trim();
    const glDirty = draft.glAccountNo.trim() !== saved.glAccountNo.trim();
    const descDirty = draft.erpDescription.trim() !== saved.erpDescription.trim();
    const bankDirty = draft.bankAccountNo.trim() !== saved.bankAccountNo.trim();
    const branchDirty = isBranchConfigDirty(draft, saved);
    const targetKey = target.toUpperCase();
    const glItems = erpByBrand[targetKey]?.gl ?? [];

    setSavingBrand(claimBrandCode);
    try {
      if (targetDirty && target) {
        const res = await fetch("/api/request/accounting/settings/erp-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandCode: claimBrandCode, interfaceBrandCode: target }),
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error ?? `บันทึก ${b.brandName} ไม่สำเร็จ`);
          return false;
        }
      }

      if (journalDirty) {
        const journalBatchNo = draft.journalBatchName.trim();
        const journalBatchOpt = (erpByBrand[targetKey]?.journalBatch ?? [])
          .find((x) => x.batchName === journalBatchNo);
        const journalRes = await fetch("/api/request/accounting/settings/journal-batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(draft.journalBatchId != null ? { id: draft.journalBatchId } : {}),
            brandCode: claimBrandCode,
            batchName: journalBatchNo,
            displayName: journalBatchOpt?.displayName ?? null,
            isActive: true,
            sortOrder: 0,
          }),
        });
        const journalJson = await journalRes.json();
        if (!journalJson.ok) {
          toast.error(journalJson.error ?? `บันทึก Journal Batch ${b.brandName} ไม่สำเร็จ`);
          return false;
        }
      }

      if (glDirty || descDirty) {
        const glOpt = glItems.find((x) => x.accountNo === draft.glAccountNo.trim());
        const glRes = await fetch("/api/request/accounting/settings/gl-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(draft.glId != null ? { id: draft.glId } : {}),
            brandCode: claimBrandCode,
            accountNo: draft.glAccountNo.trim(),
            displayName: glOpt?.displayName ?? null,
            erpDescription: resolveGlErpDescription(draft, glItems) || null,
            isActive: true,
            sortOrder: 0,
          }),
        });
        const glJson = await glRes.json();
        if (!glJson.ok) {
          toast.error(glJson.error ?? `บันทึก G/L ${b.brandName} ไม่สำเร็จ`);
          return false;
        }
      }

      if (bankDirty) {
        const bankRes = await fetch("/api/request/accounting/settings/bank-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(draft.bankId != null ? { id: draft.bankId } : {}),
            brandCode: claimBrandCode,
            accountNo: draft.bankAccountNo.trim(),
            isActive: true,
            sortOrder: 0,
          }),
        });
        const bankJson = await bankRes.json();
        if (!bankJson.ok) {
          toast.error(bankJson.error ?? `บันทึก Bank ${b.brandName} ไม่สำเร็จ`);
          return false;
        }
      }

      if (branchDirty) {
        const branchNo = draft.branchCode.trim();
        const branchOpt = (erpByBrand[targetKey]?.branch ?? []).find((x) => x.code === branchNo);
        const branchRes = await fetch("/api/request/accounting/settings/branch-codes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(draft.branchId != null ? { id: draft.branchId } : {}),
            brandCode: claimBrandCode,
            branchCode: branchNo,
            displayName: branchOpt?.displayName ?? null,
            deptAsBranch: draft.deptAsBranch,
            fixedErpDeptCode: draft.deptAsBranch ? draft.fixedErpDeptCode.trim() || null : null,
            isActive: true,
            sortOrder: 0,
          }),
        });
        const branchJson = await branchRes.json();
        if (!branchJson.ok) {
          toast.error(branchJson.error ?? `บันทึก Branch ${b.brandName} ไม่สำเร็จ`);
          return false;
        }
      }

      await refreshBrandAfterSave(claimBrandCode);
      if (!options?.quiet) {
        toast.success(`บันทึก ${b.brandName} แล้ว`);
      }
      return true;
    } catch {
      toast.error(`บันทึก ${b.brandName} ไม่สำเร็จ`);
      return false;
    } finally {
      setSavingBrand(null);
    }
  }, [
    brands,
    targetByClaim,
    savedTargetByClaim,
    accountDrafts,
    accountSaved,
    journalBatchMap,
    glMap,
    bankMap,
    branchMap,
    erpByBrand,
    refreshBrandAfterSave,
  ]);

  const refreshGroupAfterSave = useCallback(async (targetBrandCode: string) => {
    await Promise.all([
      mutate(), mutateGl(), mutateBank(), mutateJournalBatch(), mutateBranch(),
    ]);
    const group = buildTargetErpGroups(brands, savedTargetByClaim, targetBrands).groups
      .find((g) => g.targetBrandCode === targetBrandCode.toUpperCase());
    if (!group) return;

    const [glListJson, bankListJson, journalListJson, branchListJson, erpConfigJson] = await Promise.all([
      fetch("/api/request/accounting/settings/gl-accounts").then((r) => r.json()),
      fetch("/api/request/accounting/settings/bank-accounts").then((r) => r.json()),
      fetch("/api/request/accounting/settings/journal-batches").then((r) => r.json()),
      fetch("/api/request/accounting/settings/branch-codes").then((r) => r.json()),
      fetch("/api/request/accounting/settings/erp-config").then((r) => r.json()),
    ]);

    const freshGl = primaryByBrand((glListJson.data ?? []) as AccBrandAccountRow[]);
    const freshBank = primaryByBrand((bankListJson.data ?? []) as AccBrandAccountRow[]);
    const freshJournal = primaryJournalBatchByBrand((journalListJson.data ?? []) as AccBrandJournalBatchRow[]);
    const freshBranch = primaryBranchByBrand((branchListJson.data ?? []) as AccBrandBranchRow[]);
    const legacyCodes = claimCodesForGroup(group);
    const journal = resolveJournalForTarget(targetBrandCode, legacyCodes, freshJournal);

    setJournalByTarget((prev) => ({ ...prev, [targetBrandCode.toUpperCase()]: journal.batchName }));
    setSavedJournalByTarget((prev) => ({ ...prev, [targetBrandCode.toUpperCase()]: journal.batchName }));
    setJournalBatchIdByTarget((prev) => ({ ...prev, [targetBrandCode.toUpperCase()]: journal.id }));

    const configBrands = (erpConfigJson.data?.brands ?? []) as AccBrandErpConfigRow[];
    const freshTargets: Record<string, string> = {};
    for (const b of configBrands) {
      freshTargets[b.brandCode] = b.interfaceBrandCode ?? "";
    }
    setSavedTargetByClaim((prev) => ({ ...prev, ...freshTargets }));
    setTargetByClaim((prev) => ({ ...prev, ...freshTargets }));

    const savedGroup = buildAllTargetErpGroups(configBrands, freshTargets, targetBrands).groups
      .find((g) => g.targetBrandCode === targetBrandCode.toUpperCase());
    const members = savedGroup?.claimRows ?? group.claimRows;
    for (const row of members) {
      const synced = draftFromMaps(row.brandCode, freshJournal, freshGl, freshBank, freshBranch, journal);
      setAccountSaved((prev) => ({ ...prev, [row.brandCode]: synced }));
      setAccountDrafts((prev) => ({ ...prev, [row.brandCode]: { ...synced } }));
    }
  }, [brands, savedTargetByClaim, targetBrands, mutate, mutateGl, mutateBank, mutateJournalBatch, mutateBranch]);

  const saveTargetGroup = useCallback(async (
    targetBrandCode: string,
    options?: { quiet?: boolean },
  ): Promise<boolean> => {
    const group = targetGroups.find((g) => g.targetBrandCode === targetBrandCode.toUpperCase());
    if (!group) return false;

    const targetKey = targetBrandCode.toUpperCase();
    const journalDraft = journalByTarget[targetKey] ?? "";
    const journalSaved = savedJournalByTarget[targetKey] ?? "";
    const journalDirty = journalDraft.trim() !== journalSaved.trim();
    const memberCodes = groupMemberCodes(targetKey, brands, targetByClaim);

    for (const code of memberCodes) {
      const row = brands.find((b) => b.brandCode === code);
      if (!row) continue;
      const claim = row.brandCode;
      const target = targetByClaim[claim]?.trim() ?? "";
      const draft = accountDrafts[claim] ?? draftFromMaps(claim, journalBatchMap, glMap, bankMap, branchMap);
      const saved = accountSaved[claim] ?? draftFromMaps(claim, journalBatchMap, glMap, bankMap, branchMap);
      const glDirty = draft.glAccountNo.trim() !== saved.glAccountNo.trim();
      const descDirty = draft.erpDescription.trim() !== saved.erpDescription.trim();
      const bankDirty = draft.bankAccountNo.trim() !== saved.bankAccountNo.trim();
      const branchDirty = isBranchConfigDirty(draft, saved);
      const accountsDirty = glDirty || descDirty || bankDirty || branchDirty;

      if (accountsDirty && !target) {
        toast.error(`กรุณาเลือกแบรนด์ปลายทางสำหรับ ${row.brandName} ก่อนบันทึกบัญชี`);
        return false;
      }
      if (glDirty && !draft.glAccountNo.trim()) {
        toast.error(`กรุณาเลือก G/L สำหรับ ${row.brandName}`);
        return false;
      }
      if ((glDirty || descDirty) && draft.glAccountNo.trim() && !draft.erpDescription.trim()) {
        toast.error(`กรุณาระบุ Description สำหรับ ${row.brandName}`);
        return false;
      }
      if (bankDirty && !draft.bankAccountNo.trim()) {
        toast.error(`กรุณาเลือก Bank สำหรับ ${row.brandName}`);
        return false;
      }
      if (branchDirty && !draft.branchCode.trim()) {
        toast.error(`กรุณาเลือก Branch สำหรับ ${row.brandName}`);
        return false;
      }
      const deptError = validateDeptAsBranchForDraft(draft, target, erpByBrand, row.brandName);
      if (deptError) {
        toast.error(deptError);
        return false;
      }
    }

    if (journalDirty && !journalDraft.trim()) {
      toast.error(`กรุณาเลือก Journal Batch สำหรับ ${group.targetBrandName}`);
      return false;
    }

    if (!isGroupDirty(
      group, brands, targetByClaim, savedTargetByClaim,
      journalDraft, journalSaved,
      accountDrafts, accountSaved,
    )) {
      return true;
    }

    setSavingTarget(targetKey);
    try {
      for (const b of brands) {
        const savedTarget = savedTargetByClaim[b.brandCode]?.trim().toUpperCase() ?? "";
        const currentTarget = targetByClaim[b.brandCode]?.trim().toUpperCase() ?? "";
        if (savedTarget === targetKey && currentTarget !== targetKey) {
          const res = await fetch(
            `/api/request/accounting/settings/erp-config?brandCode=${encodeURIComponent(b.brandCode)}`,
            { method: "DELETE" },
          );
          const json = await res.json();
          if (!json.ok) {
            toast.error(json.error ?? `นำ ${b.brandName} ออกจากกลุ่มไม่สำเร็จ`);
            return false;
          }
        }
      }

      for (const code of memberCodes) {
        const row = brands.find((b) => b.brandCode === code);
        if (!row) continue;
        const claim = row.brandCode;
        const target = targetByClaim[claim]?.trim() ?? "";
        const savedTarget = savedTargetByClaim[claim]?.trim() ?? "";
        if (target !== savedTarget && target) {
          const res = await fetch("/api/request/accounting/settings/erp-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ brandCode: claim, interfaceBrandCode: target }),
          });
          const json = await res.json();
          if (!json.ok) {
            toast.error(json.error ?? `บันทึก ${row.brandName} ไม่สำเร็จ`);
            return false;
          }
        }
      }

      if (journalDirty) {
        const journalBatchNo = journalDraft.trim();
        const journalBatchOpt = (erpByBrand[targetKey]?.journalBatch ?? [])
          .find((x) => x.batchName === journalBatchNo);
        const journalRes = await fetch("/api/request/accounting/settings/journal-batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(journalBatchIdByTarget[targetKey] != null ? { id: journalBatchIdByTarget[targetKey] } : {}),
            brandCode: targetKey,
            batchName: journalBatchNo,
            displayName: journalBatchOpt?.displayName ?? null,
            isActive: true,
            sortOrder: 0,
          }),
        });
        const journalJson = await journalRes.json();
        if (!journalJson.ok) {
          toast.error(journalJson.error ?? `บันทึก Journal Batch ${targetKey} ไม่สำเร็จ`);
          return false;
        }
      }

      for (const code of memberCodes) {
        const row = brands.find((b) => b.brandCode === code);
        if (!row) continue;
        const claim = row.brandCode;
        const draft = accountDrafts[claim] ?? draftFromMaps(claim, journalBatchMap, glMap, bankMap, branchMap);
        const saved = accountSaved[claim] ?? draftFromMaps(claim, journalBatchMap, glMap, bankMap, branchMap);
        const glDirty = draft.glAccountNo.trim() !== saved.glAccountNo.trim();
        const descDirty = draft.erpDescription.trim() !== saved.erpDescription.trim();
        const bankDirty = draft.bankAccountNo.trim() !== saved.bankAccountNo.trim();
        const branchDirty = isBranchConfigDirty(draft, saved);
        const glItems = erpByBrand[targetKey]?.gl ?? [];

        if (glDirty || descDirty) {
          const glOpt = glItems.find((x) => x.accountNo === draft.glAccountNo.trim());
          const glRes = await fetch("/api/request/accounting/settings/gl-accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(draft.glId != null ? { id: draft.glId } : {}),
              brandCode: claim,
              accountNo: draft.glAccountNo.trim(),
              displayName: glOpt?.displayName ?? null,
              erpDescription: resolveGlErpDescription(draft, glItems) || null,
              isActive: true,
              sortOrder: 0,
            }),
          });
          const glJson = await glRes.json();
          if (!glJson.ok) {
            toast.error(glJson.error ?? `บันทึก G/L ${row.brandName} ไม่สำเร็จ`);
            return false;
          }
        }

        if (bankDirty) {
          const bankRes = await fetch("/api/request/accounting/settings/bank-accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(draft.bankId != null ? { id: draft.bankId } : {}),
              brandCode: claim,
              accountNo: draft.bankAccountNo.trim(),
              isActive: true,
              sortOrder: 0,
            }),
          });
          const bankJson = await bankRes.json();
          if (!bankJson.ok) {
            toast.error(bankJson.error ?? `บันทึก Bank ${row.brandName} ไม่สำเร็จ`);
            return false;
          }
        }

        if (branchDirty) {
          const branchNo = draft.branchCode.trim();
          const branchOpt = (erpByBrand[targetKey]?.branch ?? []).find((x) => x.code === branchNo);
          const branchRes = await fetch("/api/request/accounting/settings/branch-codes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(draft.branchId != null ? { id: draft.branchId } : {}),
              brandCode: claim,
              branchCode: branchNo,
              displayName: branchOpt?.displayName ?? null,
              deptAsBranch: draft.deptAsBranch,
              fixedErpDeptCode: draft.deptAsBranch ? draft.fixedErpDeptCode.trim() || null : null,
              isActive: true,
              sortOrder: 0,
            }),
          });
          const branchJson = await branchRes.json();
          if (!branchJson.ok) {
            toast.error(branchJson.error ?? `บันทึก Branch ${row.brandName} ไม่สำเร็จ`);
            return false;
          }
        }
      }

      await refreshGroupAfterSave(targetKey);
      if (!options?.quiet) {
        toast.success(`บันทึก ${group.targetBrandName} แล้ว`);
      }
      return true;
    } catch {
      toast.error(`บันทึก ${group.targetBrandName} ไม่สำเร็จ`);
      return false;
    } finally {
      setSavingTarget(null);
    }
  }, [
    brands,
    targetGroups,
    journalByTarget,
    savedJournalByTarget,
    journalBatchIdByTarget,
    targetByClaim,
    savedTargetByClaim,
    accountDrafts,
    accountSaved,
    journalBatchMap,
    glMap,
    bankMap,
    branchMap,
    erpByBrand,
    refreshGroupAfterSave,
  ]);

  const loading = isLoading || glLoading || bankLoading || journalBatchLoading || branchLoading || erpLoading;
  const requestErpDeptPick = useCallback((claimCode: string, branchCode: string, targetCode: string) => {
    const target = targetCode.trim().toUpperCase();
    const branch = branchCode.trim();
    if (!target || !branch) return;
    setErpDeptPick({
      targetCode: target,
      branchCode: branch,
      claimCode: claimCode.trim().toUpperCase(),
    });
  }, []);

  const confirmErpDeptPick = useCallback((erpDeptCode: string) => {
    if (!erpDeptPick) return;
    const code = erpDeptPick.claimCode;
    setAccountDrafts((prev) => ({
      ...prev,
      [code]: {
        ...(prev[code] ?? draftFromMaps(code, journalBatchMap, glMap, bankMap, branchMap)),
        deptAsBranch: true,
        fixedErpDeptCode: erpDeptCode.trim(),
      },
    }));
    setErpDeptPick(null);
  }, [erpDeptPick, journalBatchMap, glMap, bankMap, branchMap]);

  const clearErpDeptFix = useCallback((claimCode: string) => {
    setAccountDrafts((prev) => ({
      ...prev,
      [claimCode]: {
        ...(prev[claimCode] ?? draftFromMaps(claimCode, journalBatchMap, glMap, bankMap, branchMap)),
        deptAsBranch: false,
        fixedErpDeptCode: "",
      },
    }));
  }, [journalBatchMap, glMap, bankMap, branchMap]);

  const listDisabled = syncing;

  const editGroup = editTargetCode
    ? targetGroups.find((g) => g.targetBrandCode === editTargetCode.toUpperCase())
    : undefined;
  const editTargetKey = editTargetCode?.toUpperCase() ?? "";
  const editErp = editTargetKey
    ? (erpByBrand[editTargetKey] ?? { gl: [], bank: [], journalBatch: [], branch: [], department: [] })
    : { gl: [], bank: [], journalBatch: [], branch: [], department: [] };
  const editJournalDraft = editTargetKey ? (journalByTarget[editTargetKey] ?? "") : "";
  const editJournalSaved = editTargetKey ? (savedJournalByTarget[editTargetKey] ?? "") : "";
  const editGroupDirty = editGroup
    ? isGroupDirty(
      editGroup,
      brands,
      targetByClaim,
      savedTargetByClaim,
      editJournalDraft,
      editJournalSaved,
      accountDrafts,
      accountSaved,
    )
    : false;

  const editAvailableClaimsToAdd = useMemo(
    () => unassignedClaimBrands(brands, targetByClaim),
    [brands, targetByClaim],
  );

  const editUnassignedRow = editUnassignedClaim
    ? brands.find((b) => b.brandCode === editUnassignedClaim)
    : undefined;
  const editUnassignedSelectedTarget = editUnassignedClaim ? (targetByClaim[editUnassignedClaim] ?? "") : "";
  const editUnassignedSavedTarget = editUnassignedClaim ? (savedTargetByClaim[editUnassignedClaim] ?? "") : "";
  const editUnassignedErpKey = editUnassignedSelectedTarget.toUpperCase();
  const editUnassignedErp = editUnassignedClaim
    ? (erpByBrand[editUnassignedErpKey] ?? { gl: [], bank: [], journalBatch: [], branch: [], department: [] })
    : { gl: [], bank: [], journalBatch: [], branch: [], department: [] };
  const editUnassignedDraft = editUnassignedClaim
    ? (accountDrafts[editUnassignedClaim] ?? draftFromMaps(editUnassignedClaim, journalBatchMap, glMap, bankMap, branchMap))
    : { journalBatchName: "", glAccountNo: "", erpDescription: "", bankAccountNo: "", branchCode: "", deptAsBranch: false, fixedErpDeptCode: "" };
  const editUnassignedSaved = editUnassignedClaim
    ? (accountSaved[editUnassignedClaim] ?? draftFromMaps(editUnassignedClaim, journalBatchMap, glMap, bankMap, branchMap))
    : { journalBatchName: "", glAccountNo: "", erpDescription: "", bankAccountNo: "", branchCode: "", deptAsBranch: false, fixedErpDeptCode: "" };

  const revertGroupDraft = useCallback((targetBrandCode: string) => {
    const code = targetBrandCode.toUpperCase();
    setJournalByTarget((prev) => ({
      ...prev,
      [code]: savedJournalByTarget[code] ?? "",
    }));

    const savedMembers = groupMemberCodes(code, brands, savedTargetByClaim);
    const draftMembers = groupMemberCodes(code, brands, targetByClaim);
    const affected = Array.from(new Set(savedMembers.concat(draftMembers)));

    setTargetByClaim((prev) => {
      const next = { ...prev };
      for (const member of affected) {
        next[member] = savedTargetByClaim[member] ?? "";
      }
      return next;
    });

    setAccountDrafts((prev) => {
      const next = { ...prev };
      for (const member of affected) {
        next[member] = {
          ...(accountSaved[member] ?? draftFromMaps(member, journalBatchMap, glMap, bankMap, branchMap)),
        };
      }
      return next;
    });
  }, [
    brands,
    savedTargetByClaim,
    targetByClaim,
    savedJournalByTarget,
    accountSaved,
    journalBatchMap,
    glMap,
    bankMap,
    branchMap,
  ]);

  const revertBrandDraft = useCallback((claimBrandCode: string) => {
    setTargetByClaim((prev) => ({
      ...prev,
      [claimBrandCode]: savedTargetByClaim[claimBrandCode] ?? "",
    }));
    setAccountDrafts((prev) => ({
      ...prev,
      [claimBrandCode]: {
        ...(accountSaved[claimBrandCode] ?? draftFromMaps(claimBrandCode, journalBatchMap, glMap, bankMap, branchMap)),
      },
    }));
  }, [savedTargetByClaim, accountSaved, journalBatchMap, glMap, bankMap, branchMap]);

  const handleGroupDialogClose = () => {
    if (!editTargetCode) return;
    if (editGroupDirty) {
      revertGroupDraft(editTargetCode);
    }
    setEditTargetCode(null);
  };

  const handleUnassignedDialogClose = () => {
    if (!editUnassignedClaim) return;
    const dirty = isBrandDirty(
      editUnassignedClaim,
      targetByClaim,
      savedTargetByClaim,
      accountDrafts,
      accountSaved,
      journalBatchMap,
      glMap,
      bankMap,
      branchMap,
    );
    if (dirty) {
      revertBrandDraft(editUnassignedClaim);
    }
    setEditUnassignedClaim(null);
  };

  if (loading && brands.length === 0) {
    return <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>;
  }

  if (brands.length === 0) {
    return (
      <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
        ยังไม่มีแบรนด์ที่เปิดเบิกได้ — ตั้งค่าที่แท็บ &quot;แบรนด์ที่เบิกได้&quot; ก่อน
      </p>
    );
  }

  return (
    <div>
      <ErpAccountSyncPopup state={syncPopup} />
      <ErpJournalTemplateSettings />

      <div
        className="rounded-xl px-4 py-3 mb-4 flex flex-wrap items-start justify-between gap-3"
        style={{
          background: "var(--nav-active-bg)",
          border: "1px solid var(--border-card)",
        }}
      >
        <div className="flex-1 min-w-[200px]">
          <p className="text-[13px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
            Interface ERP
          </p>
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            แสดง Interface ทั้งหมด (PCTH, KSI, PCMY, UNO) — คลิกกลุ่มเพื่อเพิ่ม/ลบแบรนด์เบิก
          </p>
          <p className="text-[10px] m-0 mt-1" style={{ color: "var(--text-faint)" }}>
            ตั้งค่าครบ {completeCount}/{brands.length} แบรนด์เบิก · {targetGroups.length} กลุ่ม
          </p>
          {canSyncErp && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2.5">
              <span className="text-[10px] font-semibold shrink-0" style={{ color: "var(--text-muted)" }}>
                Sync:
              </span>
              <label
                className="inline-flex items-center gap-1.5 cursor-pointer select-none"
                style={{
                  color: allSyncSelected || someSyncSelected
                    ? "var(--text-secondary)"
                    : "var(--text-faint)",
                }}
              >
                <input
                  ref={(el) => {
                    if (el) el.indeterminate = someSyncSelected;
                  }}
                  type="checkbox"
                  checked={allSyncSelected}
                  disabled={syncing}
                  onChange={(e) => setAllSyncPhases(e.target.checked)}
                  className="rounded cursor-pointer"
                  style={{ accentColor: "var(--nav-active-text)" }}
                />
                <span className="text-[11px] font-bold">All</span>
              </label>
              <span
                className="w-px h-3.5 shrink-0"
                style={{ background: "var(--border-card)" }}
                aria-hidden
              />
              {SYNC_PHASES.map(({ phase, label }) => {
                const checked = syncPhasesSelected[phase];
                return (
                  <label
                    key={phase}
                    className="inline-flex items-center gap-1.5 cursor-pointer select-none"
                    style={{ color: checked ? "var(--text-secondary)" : "var(--text-faint)" }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={syncing}
                      onChange={(e) =>
                        setSyncPhasesSelected((prev) => ({ ...prev, [phase]: e.target.checked }))
                      }
                      className="rounded cursor-pointer"
                      style={{ accentColor: "var(--nav-active-text)" }}
                    />
                    <span className="text-[11px] font-medium">{label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        {canSyncErp ? (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="secondary"
              icon={<RefreshCw size={15} className={syncing ? "animate-spin" : ""} />}
              onClick={() => void syncErp()}
              loading={syncing}
              disabled={activeSyncPhases.length === 0}
            >
              Sync ERP
            </Button>
          </div>
        ) : (
          <p className="text-[10px] m-0 shrink-0 max-w-[190px]" style={{ color: "var(--text-faint)" }}>
            การ Sync ข้อมูลจาก Business Central สงวนไว้สำหรับผู้ดูแลระบบ
          </p>
        )}
      </div>

      <p className="text-[11px] mb-4 m-0 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: "var(--text-faint)" }}>
        <Link
          href="/settings/brand-config"
          className="inline-flex items-center gap-1 no-underline font-medium"
          style={{ color: "var(--nav-active-text)" }}
        >
          แก้ไข BC ที่ Settings → Brand Config
          <ExternalLink size={12} />
        </Link>
      </p>

      <div className="flex flex-wrap gap-3 mb-4 text-[11px]">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--text-info-green)" }} />
          ตั้งค่าครบแล้ว
        </span>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--text-info-yellow)" }} />
          ยังไม่ครบ / รอบันทึก
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {targetGroups.map((group) => {
          const targetKey = group.targetBrandCode;
          return (
            <TargetErpSummaryCard
              key={targetKey}
              group={group}
              brands={brands}
              targetBrands={targetBrands}
              targetByClaim={targetByClaim}
              savedTargetByClaim={savedTargetByClaim}
              journalDraft={journalByTarget[targetKey] ?? ""}
              journalSaved={savedJournalByTarget[targetKey] ?? ""}
              accountDrafts={accountDrafts}
              accountSaved={accountSaved}
              disabled={listDisabled}
              onClick={() => setEditTargetCode(targetKey)}
            />
          );
        })}
        {unassignedBrands.map((row) => {
          const selectedTarget = targetByClaim[row.brandCode] ?? "";
          const savedTarget = savedTargetByClaim[row.brandCode] ?? "";
          const draft = accountDrafts[row.brandCode] ?? draftFromMaps(row.brandCode, journalBatchMap, glMap, bankMap, branchMap);
          const saved = accountSaved[row.brandCode] ?? draftFromMaps(row.brandCode, journalBatchMap, glMap, bankMap, branchMap);

          return (
            <BrandErpSummaryCard
              key={row.brandCode}
              row={row}
              targetBrands={targetBrands}
              selectedTarget={selectedTarget}
              savedTarget={savedTarget}
              accountDraft={draft}
              accountSaved={saved}
              disabled={listDisabled}
              onClick={() => setEditUnassignedClaim(row.brandCode)}
            />
          );
        })}
      </div>

      {unassignedBrands.length > 0 && targetGroups.length > 0 && (
        <p className="text-[11px] mt-3 m-0" style={{ color: "var(--text-faint)" }}>
          แบรนด์ที่ยังไม่ตั้งปลายทางแสดงแยก — ตั้ง &quot;ส่งเข้าแบรนด์&quot; ก่อนจะรวมเข้ากลุ่ม
        </p>
      )}

      {editGroup && (
        <Dialog
          open={editTargetCode != null}
          onOpenChange={(open) => { if (!open) handleGroupDialogClose(); }}
          title={`${editGroup.targetBrandName} — Interface ERP`}
          contentClassName="max-w-4xl max-h-[90vh]"
          scrollable={false}
          uniformSurface
          hideTitle
        >
          <div className="flex flex-col min-h-0 max-h-[90vh]">
            <div
              className="shrink-0 px-6 pt-5 pb-3.5 pr-14"
              style={{ borderBottom: "1px solid var(--border-light)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex items-center justify-center shrink-0 rounded-xl p-2 mt-0.5"
                  style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
                >
                  <img
                    src={editGroup.targetBrandLogo}
                    alt=""
                    className="h-8 w-auto object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-bold m-0 leading-snug" style={{ color: "var(--text-heading)" }}>
                    {editGroup.targetBrandName}
                    <span className="font-normal" style={{ color: "var(--text-muted)" }}> — Interface ERP</span>
                  </p>
                  {editGroup.claimRows.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {editGroup.claimRows.map((claim) => (
                        <span
                          key={claim.brandCode}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{
                            background: "var(--bg-card-alt)",
                            border: "1px solid var(--border-light)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {claim.brandLogo && (
                            <img
                              src={claim.brandLogo}
                              alt=""
                              className="h-3.5 w-auto object-contain shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          )}
                          {claim.brandName}
                        </span>
                      ))}
                      <span className="text-[10px] ml-1" style={{ color: "var(--text-faint)" }}>
                        · Journal ร่วมกลุ่ม · บัญชีแยกตามแบรนด์
                      </span>
                    </div>
                  ) : (
                    <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
                      ยังไม่มีแบรนด์เบิก — เพิ่มด้านล่าง
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto dialog-scroll px-6 py-4">
              <TargetErpGroupEditForm
                group={editGroup}
                targetBrands={targetBrands}
                journalDraft={editJournalDraft}
                journalSaved={editJournalSaved}
                accountDrafts={accountDrafts}
                accountSaved={accountSaved}
                availableClaimsToAdd={editAvailableClaimsToAdd}
                journalBatchOptions={journalBatchSelectOptions(editErp.journalBatch, editJournalDraft)}
                glOptions={accountSelectOptions(editErp.gl)}
                bankOptions={accountSelectOptions(editErp.bank)}
                branchOptions={branchSelectOptions(editErp.branch)}
                journalBatchReady={editErp.journalBatch.length > 0}
                erpReady={editErp.gl.length > 0 || editErp.bank.length > 0}
                branchReady={editErp.branch.length > 0}
                disabled={syncing || savingTarget === editTargetKey}
                onChangeJournal={(batchName) => {
                  setJournalByTarget((prev) => ({ ...prev, [editTargetKey]: batchName }));
                  const claimCodes = groupMemberCodes(editTargetKey, brands, targetByClaim);
                  setAccountDrafts((prev) => {
                    const next = { ...prev };
                    for (const code of claimCodes) {
                      next[code] = {
                        ...(next[code] ?? { glAccountNo: "", erpDescription: "", bankAccountNo: "", branchCode: "", deptAsBranch: false, fixedErpDeptCode: "" }),
                        journalBatchName: batchName,
                      };
                    }
                    return next;
                  });
                }}
                onChangeClaimAccounts={(claimCode, patch) =>
                  setAccountDrafts((prev) => ({
                    ...prev,
                    [claimCode]: {
                      ...(prev[claimCode] ?? {
                        journalBatchName: editJournalDraft,
                        glAccountNo: "",
                        erpDescription: "",
                        bankAccountNo: "",
                        branchCode: "",
                        deptAsBranch: false, fixedErpDeptCode: "",
                      }),
                      ...patch,
                    },
                  }))
                }
                onAddClaim={(claimCode) => {
                  setTargetByClaim((prev) => ({ ...prev, [claimCode]: editTargetKey }));
                  setAccountDrafts((prev) => ({
                    ...prev,
                    [claimCode]: {
                      journalBatchName: editJournalDraft,
                      glAccountNo: prev[claimCode]?.glAccountNo ?? "",
                      erpDescription: prev[claimCode]?.erpDescription ?? "",
                      bankAccountNo: prev[claimCode]?.bankAccountNo ?? "",
                      branchCode: prev[claimCode]?.branchCode ?? "",
                      deptAsBranch: prev[claimCode]?.deptAsBranch ?? false,
                      fixedErpDeptCode: prev[claimCode]?.fixedErpDeptCode ?? "",
                    },
                  }));
                }}
                onRemoveClaim={(claimCode) => {
                  setTargetByClaim((prev) => ({ ...prev, [claimCode]: "" }));
                  setAccountDrafts((prev) => ({
                    ...prev,
                    [claimCode]: {
                      journalBatchName: "",
                      glAccountNo: "",
                      erpDescription: "",
                      bankAccountNo: "",
                      branchCode: "",
                      deptAsBranch: false, fixedErpDeptCode: "",
                    },
                  }));
                }}
                onRequestDeptPick={(claimCode, branchCode) => {
                  requestErpDeptPick(claimCode, branchCode, editTargetKey);
                }}
                onClearDeptFix={(claimCode) => {
                  clearErpDeptFix(claimCode);
                }}
              />
            </div>
            <div
              className="shrink-0 px-6 py-4 flex flex-wrap items-center justify-between gap-3"
              style={{ borderTop: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}
            >
              <p className="text-[10px] m-0 hidden sm:flex items-center gap-1.5" style={{ color: "var(--text-faint)" }}>
                {editGroupDirty ? (
                  <>
                    <Circle size={12} style={{ color: "var(--text-info-yellow)" }} />
                    มีการเปลี่ยนแปลงที่ยังไม่บันทึก — ปิดเพื่อยกเลิก
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={12} style={{ color: "var(--text-info-green)" }} />
                    บันทึกแล้ว
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
              <Button
                type="button"
                variant="primary"
                onClick={() => void saveTargetGroup(editTargetKey)}
                loading={savingTarget === editTargetKey}
                disabled={!editGroupDirty || syncing}
              >
                บันทึก
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleGroupDialogClose}
                disabled={syncing}
              >
                ปิด
              </Button>
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {editUnassignedRow && (
        <Dialog
          open={editUnassignedClaim != null}
          onOpenChange={(open) => { if (!open) handleUnassignedDialogClose(); }}
          title={`${editUnassignedRow.brandName} — Interface ERP`}
          description={`แบรนด์เบิก: ${editUnassignedRow.brandCode}`}
          contentClassName="max-w-2xl"
          scrollable
          uniformSurface
          hideTitle
        >
          <div className="flex items-center gap-3 mb-1">
            {editUnassignedRow.brandLogo && (
              <img
                src={editUnassignedRow.brandLogo}
                alt=""
                className="h-10 w-auto object-contain shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="min-w-0">
              <p className="text-[16px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
                {editUnassignedRow.brandName} — Interface ERP
              </p>
              <p className="text-[12px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                แบรนด์เบิก: {editUnassignedRow.brandCode} · ยังไม่รวมกลุ่ม
              </p>
            </div>
          </div>
          <BrandErpEditForm
            row={editUnassignedRow}
            targetBrands={targetBrands}
            selectedTarget={editUnassignedSelectedTarget}
            savedTarget={editUnassignedSavedTarget}
            accountDraft={editUnassignedDraft}
            accountSaved={editUnassignedSaved}
            journalBatchOptions={journalBatchSelectOptions(editUnassignedErp.journalBatch, editUnassignedDraft.journalBatchName)}
            glOptions={accountSelectOptions(editUnassignedErp.gl, editUnassignedDraft.glAccountNo)}
            bankOptions={accountSelectOptions(editUnassignedErp.bank, editUnassignedDraft.bankAccountNo)}
            branchOptions={branchSelectOptions(editUnassignedErp.branch, editUnassignedDraft.branchCode)}
            journalBatchReady={editUnassignedErp.journalBatch.length > 0}
            erpReady={editUnassignedErp.gl.length > 0 || editUnassignedErp.bank.length > 0}
            branchReady={editUnassignedErp.branch.length > 0}
            disabled={syncing || savingBrand === editUnassignedRow.brandCode}
            onSelectTarget={(value) => {
              const prevSavedTarget = savedTargetByClaim[editUnassignedRow.brandCode] ?? "";
              setTargetByClaim((prev) => ({ ...prev, [editUnassignedRow.brandCode]: value }));
              if (value !== prevSavedTarget) {
                setAccountDrafts((prev) => ({
                  ...prev,
                  [editUnassignedRow.brandCode]: {
                    journalBatchName: "",
                    glAccountNo: "",
                    erpDescription: "",
                    bankAccountNo: "",
                    branchCode: "",
                    deptAsBranch: false, fixedErpDeptCode: "",
                  },
                }));
              }
            }}
            onChangeAccounts={(patch) =>
              setAccountDrafts((prev) => ({
                ...prev,
                [editUnassignedRow.brandCode]: { ...prev[editUnassignedRow.brandCode] ?? editUnassignedDraft, ...patch },
              }))
            }
            onRequestDeptPick={() => {
              requestErpDeptPick(
                editUnassignedRow.brandCode,
                editUnassignedDraft.branchCode,
                editUnassignedSelectedTarget,
              );
            }}
            onClearDeptFix={() => {
              clearErpDeptFix(editUnassignedRow.brandCode);
            }}
          />
          <div
            className="flex flex-wrap items-center justify-end gap-2 mt-5 pt-4"
            style={{ borderTop: "1px solid var(--border-light)" }}
          >
            <Button
              type="button"
              variant="secondary"
              onClick={handleUnassignedDialogClose}
              disabled={syncing}
            >
              ปิด
            </Button>
          </div>
        </Dialog>
      )}

      <ErpDeptFixDialog
        open={erpDeptPick != null}
        onOpenChange={(open) => {
          if (!open) setErpDeptPick(null);
        }}
        targetBrandCode={erpDeptPick?.targetCode ?? ""}
        targetBrandName={
          findTarget(targetBrands, erpDeptPick?.targetCode ?? "")?.brandName
          ?? erpDeptPick?.targetCode
          ?? ""
        }
        branchCode={erpDeptPick?.branchCode ?? ""}
        initialCode={
          erpDeptPick
            ? (accountDrafts[erpDeptPick.claimCode]?.fixedErpDeptCode ?? "")
            : ""
        }
        departmentOptions={
          erpDeptPick
            ? (erpByBrand[erpDeptPick.targetCode]?.department ?? [])
            : []
        }
        onConfirm={confirmErpDeptPick}
      />
    </div>
  );
}
