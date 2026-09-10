"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  GitBranch,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";
import { ErpDeptFixDialog, type ErpDeptOption } from "@/features/accounting/components/settings/ErpDeptFixDialog";
import type {
  ReimburseErpGroup,
  ReimburseErpGroupsView,
  ReimburseErpGroupSaveInput,
  ReimburseErpMemberRow,
} from "@/lib/acc/reimburse/erp-interface-settings-service";

const ERP_INTERFACE_URL = "/api/request/reimburse/settings/erp-interface";

type SelectOption = { value: string; label: string; subLabel?: string };
interface AcctOpt { accountNo: string; displayName: string | null }
interface BatchOpt { batchName: string; displayName: string | null; templateName: string | null }
interface BranchOpt { code: string; displayName: string | null }
interface CompanyErp { gl: AcctOpt[]; bank: AcctOpt[]; journalBatch: BatchOpt[]; branch: BranchOpt[] }
interface CompanyDept { department: ErpDeptOption[] }

/**
 * Throws on a non-2xx status OR a resolved `{ ok: false }` body — not just a
 * network failure. Found in the final review: the old
 * `fetch(url).then(r => r.json())` resolved normally for a 500 carrying
 * `{ ok: false, error }`, so SWR treated that as a successful revalidation and
 * overwrote the last good `data` with the failure body. That is what let a
 * failed refetch after a successful Save make `groups` (and this modal's own
 * `editGroup`) go empty — SWR's actual default, once the fetcher rejects
 * instead of resolving, is to KEEP the last good `data` and set `error`
 * beside it, which is what the three failure states below now rely on. It is
 * also what makes the plain `mutate()` calls in `refresh()`/`load()` actually
 * reject on failure, instead of resolving quietly with a success toast beside
 * a red failure panel.
 */
async function fetcher(url: string) {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  }
  return json;
}

function decode(v: string | null | undefined): string {
  if (!v?.trim()) return "—";
  try { return decodeURIComponent(v.trim()); } catch { return v.trim(); }
}

function acctOptions(items: AcctOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.accountNo)) continue;
    seen.add(o.accountNo);
    const sub = o.displayName?.trim() && o.displayName.trim() !== o.accountNo ? o.displayName.trim() : undefined;
    out.push({ value: o.accountNo, label: o.accountNo, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function branchOptions(items: BranchOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.code)) continue;
    seen.add(o.code);
    const sub = o.displayName?.trim() && o.displayName.trim() !== o.code ? o.displayName.trim() : undefined;
    out.push({ value: o.code, label: o.code, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function batchOptions(items: BatchOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.batchName)) continue;
    seen.add(o.batchName);
    const sub = [
      o.templateName?.trim(),
      o.displayName?.trim() && o.displayName.trim() !== o.batchName ? o.displayName.trim() : null,
    ].filter(Boolean).join(" · ") || undefined;
    out.push({ value: o.batchName, label: o.batchName, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>{children}</p>;
}

function SettingsPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl overflow-hidden ${className}`}
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      {children}
    </div>
  );
}

/**
 * "ตั้งค่าครบ" / "ยังไม่ครบ" — never "พร้อมส่ง". `ready` means the
 * configuration is complete (a bank account and a journal batch are set and
 * the Business Central profile resolves), not that anything is about to be
 * sent — AP-4 has no send path at all yet (CLAUDE.md: "AP-4 never reaches
 * Business Central, deliberately"). AP-2's equivalent panel earns "พร้อมส่ง"
 * because AP-2 sends; wearing that word here would promise an action that
 * cannot happen.
 */
function StatusBadge({ ready }: { ready: boolean }) {
  const Icon = ready ? CheckCircle2 : Circle;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
      style={ready
        ? { background: "color-mix(in srgb, var(--text-info-green) 15%, transparent)", color: "var(--text-info-green)" }
        : { background: "var(--bg-badge)", color: "var(--text-muted)" }}>
      <Icon size={12} />{ready ? "ตั้งค่าครบ" : "ยังไม่ครบ"}
    </span>
  );
}

function bcLineFor(group: ReimburseErpGroup): string {
  return [decode(group.bcName), group.bcConnectionName?.trim()].filter((v) => v && v !== "—").join(" · ") || "—";
}

function MemberBrandChips({ members }: { members: ReimburseErpMemberRow[] }) {
  if (members.length === 0) {
    return <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>ยังไม่มีแบรนด์เบิก</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => (
        <span
          key={m.brandCode}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)", color: "var(--text-secondary)" }}
        >
          {m.brandLogo && (
            <img src={m.brandLogo} alt="" className="h-3 w-auto object-contain shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          {m.brandName}
        </span>
      ))}
    </div>
  );
}

/**
 * One card per interface target (PCTH / KSI / PCMY / UNO) — Task 8's grouped
 * replacement for the old one-card-per-claim-brand list. `group.ready` is
 * read straight off the server: a member's bank account and the group's
 * journal batch both fall back to AP-1's own defaults when AP-4 has no
 * override, so a group can read ตั้งค่าครบ with zero rows of its own under
 * `FormCode = 'AP-4'` — see `erp-interface-settings-service.ts`'s docblock.
 * That is why this card never says "AP-4 has its own configuration"; ตั้งค่าครบ
 * means configured, whoever configured it.
 */
function ReimburseErpGroupCard({ group, onEdit }: { group: ReimburseErpGroup; onEdit: () => void }) {
  const journalLabel = group.journalBatchName?.trim() || "—";
  const bcLine = bcLineFor(group);

  return (
    <button
      type="button"
      onClick={onEdit}
      className="group w-full text-left rounded-xl p-4 transition-[box-shadow,border-color,transform] duration-200 hover:shadow-md active:scale-[0.998]"
      style={{
        background: group.ready ? "var(--bg-info-green)" : "var(--bg-card-alt)",
        border: `1px solid ${group.ready ? "var(--border-info-green)" : "var(--border-card)"}`,
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="flex items-center justify-center shrink-0 rounded-lg p-1.5"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)" }}
        >
          {group.targetLogo && (
            <img src={group.targetLogo} alt="" className="h-7 w-auto object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
            {group.targetName}
          </p>
          <p className="text-[10px] m-0 font-mono" style={{ color: "var(--text-muted)" }}>{group.targetCode}</p>
        </div>
        <StatusBadge ready={group.ready} />
      </div>

      <div className="mb-3">
        <MemberBrandChips members={group.members} />
      </div>

      <div className="pt-3 flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--border-light)" }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
            Journal Batch
          </span>
          <span className="text-[11px] font-medium truncate max-w-[60%]" style={{ color: journalLabel === "—" ? "var(--text-muted)" : "var(--text-primary)" }} title={journalLabel}>
            {journalLabel}
          </span>
        </div>
        <p className="text-[10px] m-0 truncate" style={{ color: "var(--text-faint)" }} title={bcLine}>
          {bcLine}{group.environment ? ` · ${group.environment === "Sandbox" ? "UAT" : "PROD"}` : ""}
        </p>
      </div>

      <div className="flex justify-end mt-3">
        <span
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg opacity-80 group-hover:opacity-100"
          style={{ color: "var(--nav-active-text)", background: "var(--nav-active-bg)" }}
        >
          <Pencil size={12} />
          แก้ไข
        </span>
      </div>
    </button>
  );
}

function UnassignedBrandChip({ row }: { row: ReimburseErpMemberRow }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
      style={{ background: "var(--bg-card-alt)", border: "1px dashed var(--border-light)", color: "var(--text-secondary)" }}
    >
      {row.brandLogo && (
        <img src={row.brandLogo} alt="" className="h-3.5 w-auto object-contain shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      )}
      {row.brandName}
      <span className="font-mono text-[9px]" style={{ color: "var(--text-faint)" }}>{row.brandCode}</span>
    </span>
  );
}

/**
 * The "Fix Dept" control beneath a row's Branch Code select — a trimmed copy
 * of AP-1's `ErpDeptFixField` (not exported from `BrandErpInterfaceSettings.tsx`,
 * so it cannot be imported; the picker it opens, `ErpDeptFixDialog`, IS
 * exported and is reused as-is below). Disabled until a Branch Code is picked
 * — `mergeFormBrandBranch` refuses `deptAsBranch: true` with a blank branch,
 * so this keeps that state out of reach from the UI rather than only
 * reporting it after a failed save.
 */
function FixDeptControl({
  branchCode,
  deptAsBranch,
  fixedErpDeptCode,
  disabled,
  /** I6 (final review): true when the `erp-accounts` department fetch itself
   *  failed. Distinguishes "the list couldn't load" from "this branch has no
   *  departments" — before this, both rendered the same enabled button that
   *  opened onto an empty picker with no explanation either way. */
  deptFailed,
  onPick,
  onClear,
}: {
  branchCode: string;
  deptAsBranch: boolean;
  fixedErpDeptCode: string;
  disabled?: boolean;
  deptFailed?: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  const active = deptAsBranch && !!fixedErpDeptCode.trim();
  const pickDisabled = disabled || !branchCode.trim();

  if (active) {
    return (
      <div
        className="mt-1.5 w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg"
        style={{
          background: "color-mix(in srgb, var(--text-info-green) 10%, var(--bg-card))",
          border: "1px solid color-mix(in srgb, var(--text-info-green) 28%, transparent)",
        }}
        title={`Journal ใช้ Dept: ${fixedErpDeptCode}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GitBranch size={11} className="shrink-0" style={{ color: "var(--text-info-green)" }} />
          <span className="text-[9px] font-bold uppercase tracking-wide shrink-0" style={{ color: "var(--text-info-green)" }}>
            Fix
          </span>
          <span className="font-mono text-[11px] font-semibold leading-none" style={{ color: "var(--text-primary)" }}>
            {fixedErpDeptCode}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onPick}
            disabled={pickDisabled}
            title="เปลี่ยน Dept"
            className="inline-flex items-center justify-center h-6 w-6 rounded-md transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--text-secondary)", border: "1px solid color-mix(in srgb, var(--text-info-green) 25%, var(--border-light))", background: "var(--bg-card)" }}
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            title="ยกเลิก Fix Dept"
            className="inline-flex items-center justify-center h-6 w-6 rounded-md transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--text-muted)", border: "1px solid color-mix(in srgb, var(--text-info-green) 25%, var(--border-light))", background: "var(--bg-card)" }}
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
      onClick={onPick}
      disabled={pickDisabled}
      title={
        pickDisabled
          ? "เลือก Branch ก่อน"
          : deptFailed
            ? "โหลดรายการแผนกไม่สำเร็จ — กด รีเฟรช"
            : "เลือก Dept ERP ที่ต้องการ Fix"
      }
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

interface DraftMember {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  bankAccountNo: string;
  branchCode: string;
  deptAsBranch: boolean;
  fixedErpDeptCode: string;
}

function toDraft(m: ReimburseErpMemberRow): DraftMember {
  return {
    brandCode: m.brandCode,
    brandName: m.brandName,
    brandLogo: m.brandLogo,
    bankAccountNo: m.bankAccountNo ?? "",
    branchCode: m.branchCode ?? "",
    deptAsBranch: m.deptAsBranch,
    fixedErpDeptCode: m.fixedErpDeptCode ?? "",
  };
}

const MEMBER_ROW_GRID = "minmax(160px,1.1fr) minmax(0,1fr) minmax(0,1.3fr) 2.75rem";

function MemberBrandCell({ brandName, brandCode, brandLogo }: { brandName: string; brandCode: string; brandLogo: string | null }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {brandLogo ? (
        <img src={brandLogo} alt="" className="h-8 w-8 object-contain shrink-0 rounded-md p-0.5"
          style={{ background: "var(--bg-card)" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <span className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-[9px] font-bold"
          style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}>
          {brandCode.slice(0, 2)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold m-0 truncate leading-tight" style={{ color: "var(--text-heading)" }}>{brandName}</p>
        <p className="text-[10px] m-0 font-mono leading-tight mt-0.5" style={{ color: "var(--text-faint)" }}>{brandCode}</p>
      </div>
    </div>
  );
}

/**
 * The edit modal for one group — Task 8, Step 2 of the brief.
 *
 * **No G/L Account column and no Description column**, unlike AP-1's
 * near-identical-looking table (`TargetErpGroupEditForm` in
 * `BrandErpInterfaceSettings.tsx`). AP-4 resolves its G/L per expense LINE
 * (`AccReimburseItem.Category`), proposed by the AI document read and
 * corrected by accounting from the queue (`PATCH .../requests/[id]/items`) —
 * a per-brand default underneath a per-line answer would be a second answer
 * to a question this form already settles elsewhere. Description lives on
 * `AccBrandGlAccount.ErpDescription`, a table AP-4 never writes; see
 * `erp-interface-settings-service.ts`'s own docblock for both.
 *
 * **Removal is immediate, not deferred to Save.** A member present when the
 * modal opened (`persistedCodes`) is removed by calling `DELETE
 * ?brandCode=` right away — `saveReimburseErpGroup` never removes a member on
 * its own (see the service docblock), and deferring removal to the Save
 * button would trap an admin who wants to empty a group entirely: Save is
 * disabled on an empty member list (there is nowhere to put the journal
 * batch — see below), so if removal only took effect at Save time, removing
 * the last member would leave no way to ever persist that removal. A member
 * added in this session and not yet saved has no server row to delete, so
 * removing it is local-only.
 *
 * **Save posts the whole current member list plus the shared Journal
 * Batch.** `saveReimburseErpGroup` fans the batch out to every member's own
 * claim-brand row — see the service docblock for why it must never be stored
 * once against the target — so Save is disabled outright on an empty group,
 * disabled while any member has no Bank Account, and disabled while any
 * member has Fix Dept set with a blank Branch Code (`mergeFormBrandBranch`
 * refuses that combination server-side); the reason is named next to the
 * button in each case, per the brief.
 */
function ReimburseErpGroupModal({
  group,
  unassigned,
  erp,
  erpFailed,
  departmentOptions,
  deptFailed,
  onClose,
  onSaved,
}: {
  group: ReimburseErpGroup;
  unassigned: ReimburseErpMemberRow[];
  erp: CompanyErp | undefined;
  /** True when the `erp-master` fetch itself failed — distinct from `!erp`,
   *  which is also true for a company that genuinely has no rows yet. Without
   *  the distinction an admin sees the same `erpUnavailableLabel` placeholder
   *  either way — "Business Central really has nothing" and "the request
   *  500'd" read identically, and only one of those is fixed by retrying. */
  erpFailed: boolean;
  departmentOptions: ErpDeptOption[];
  /** True when the `erp-accounts` (department) fetch itself failed — same
   *  distinction as `erpFailed`, fed to `FixDeptControl`'s title so an empty
   *  picker reads as "couldn't load" rather than "this branch has no
   *  departments". */
  deptFailed: boolean;
  onClose: () => void;
  /** May return a promise — see `handleSave`'s own comment for why it is
   *  awaited rather than fired and forgotten. */
  onSaved: () => void | Promise<void>;
}) {
  const [journalDraft, setJournalDraft] = useState(group.journalBatchName ?? "");
  const [members, setMembers] = useState<DraftMember[]>(() => group.members.map(toDraft));
  /**
   * Which members are actually PERSISTED — derived from the `group` prop, not
   * snapshotted at mount.
   *
   * It was a `useState` initialiser, and that was wrong in both directions
   * because `handleSave` calls `onSaved()` (refetch) but not `onClose()`, so
   * this modal stays mounted with its key unchanged across a save. Open a
   * group → เพิ่มแบรนด์ → บันทึก → press the trash on that same row: the
   * mount-time snapshot still says the brand was never saved, so `handleRemove`
   * splices it locally and issues NO DELETE — and `saveReimburseErpGroup`
   * never removes members it is not handed, so the mapping survives, no error
   * is shown, and the brand reappears grouped on the next open. A second Save
   * cannot remove it either. The mirror case is harmless but the same root
   * cause: after a successful DELETE, re-adding and re-removing sent a DELETE
   * for a row that no longer existed.
   *
   * `onSaved()` refreshes `group`, so deriving from it is correct after every
   * operation rather than only before the first.
   */
  /**
   * Codes this modal has itself POSTed successfully, remembered locally.
   *
   * `await onSaved()` closes the *timing* window but not the *failure* one: if
   * the post-save refetch fails, `group` keeps its pre-save value, so a member
   * that really was persisted is absent from it and `handleRemove` takes the
   * "never saved, nothing to delete" branch — the same no-DELETE bug, reached
   * through a failed GET instead of a race. `load()` swallows the rejection,
   * so the admin has seen a success toast and has no reason to suspect it.
   *
   * A ref rather than state: nothing renders from it, and it must not be reset
   * by the re-render the refetch causes when it succeeds.
   */
  const locallySavedRef = useRef<Set<string>>(new Set());
  const persistedCodes = useMemo(() => {
    const set = new Set(group.members.map((m) => m.brandCode));
    locallySavedRef.current.forEach((code) => set.add(code));
    return set;
  }, [group]);
  const [addCode, setAddCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingCode, setRemovingCode] = useState<string | null>(null);
  const [deptPick, setDeptPick] = useState<{ brandCode: string; branchCode: string; initialCode: string } | null>(null);

  const bankOpts = useMemo(() => acctOptions(erp?.bank ?? []), [erp]);
  const branchOpts = useMemo(() => branchOptions(erp?.branch ?? []), [erp]);
  const journalOpts = useMemo(() => batchOptions(erp?.journalBatch ?? [], journalDraft), [erp, journalDraft]);
  const noErp = !erp;
  // Distinct wording for "the fetch itself failed" versus "this company
  // genuinely has nothing yet" — see the `erpFailed` prop's own comment.
  const erpUnavailableLabel = erpFailed ? "โหลดข้อมูล ERP ไม่สำเร็จ — กด รีเฟรช" : "ไม่มีข้อมูลจาก ERP";

  const addOptions = useMemo(
    () => unassigned
      .filter((u) => !members.some((m) => m.brandCode === u.brandCode))
      .map((u) => ({ value: u.brandCode, label: `${u.brandName} (${u.brandCode})` })),
    [unassigned, members],
  );

  const missingBank = members.find((m) => !m.bankAccountNo.trim());
  const missingDeptBranch = members.find((m) => m.deptAsBranch && !m.branchCode.trim());
  const saveDisabledReason: string | null =
    members.length === 0
      ? "เพิ่มแบรนด์เบิกอย่างน้อย 1 แบรนด์ก่อนบันทึก"
      : missingBank
        ? `กรุณาเลือก Bank Account ให้ ${missingBank.brandName}`
        : missingDeptBranch
          ? `กรุณาเลือก Branch Code ให้ ${missingDeptBranch.brandName} ก่อนตั้ง Fix Dept`
          : null;

  function updateMember(brandCode: string, patch: Partial<DraftMember>) {
    setMembers((prev) => prev.map((m) => (m.brandCode === brandCode ? { ...m, ...patch } : m)));
  }

  function handleBranchChange(brandCode: string, value: string) {
    // Clearing the branch cannot leave a Fix Dept referencing a branch that
    // no longer has a value — see this component's own docblock.
    if (value.trim()) {
      updateMember(brandCode, { branchCode: value });
    } else {
      updateMember(brandCode, { branchCode: value, deptAsBranch: false, fixedErpDeptCode: "" });
    }
  }

  function handleAdd() {
    if (!addCode) return;
    const row = unassigned.find((u) => u.brandCode === addCode);
    if (!row) return;
    setMembers((prev) => prev.concat([{
      brandCode: row.brandCode,
      brandName: row.brandName,
      brandLogo: row.brandLogo,
      bankAccountNo: "",
      branchCode: "",
      deptAsBranch: false,
      fixedErpDeptCode: "",
    }]));
    setAddCode("");
  }

  async function handleRemove(member: DraftMember) {
    if (!persistedCodes.has(member.brandCode)) {
      // Never saved — nothing to delete server-side.
      setMembers((prev) => prev.filter((m) => m.brandCode !== member.brandCode));
      return;
    }
    setRemovingCode(member.brandCode);
    try {
      const res = await fetch(`${ERP_INTERFACE_URL}?brandCode=${encodeURIComponent(member.brandCode)}`, { method: "DELETE" });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "ลบไม่สำเร็จ");
      setMembers((prev) => prev.filter((m) => m.brandCode !== member.brandCode));
      toast.success(`นำ ${member.brandName} ออกจากกลุ่มแล้ว`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setRemovingCode(null);
    }
  }

  async function handleSave() {
    if (saveDisabledReason) return;
    setSaving(true);
    try {
      const body: ReimburseErpGroupSaveInput = {
        targetCode: group.targetCode,
        journalBatchName: journalDraft.trim() || null,
        members: members.map((m) => ({
          brandCode: m.brandCode,
          bankAccountNo: m.bankAccountNo.trim(),
          branchCode: m.branchCode.trim() || null,
          deptAsBranch: m.deptAsBranch,
          fixedErpDeptCode: m.fixedErpDeptCode.trim() || null,
        })),
      };
      const res = await fetch(ERP_INTERFACE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      // Recorded BEFORE the refetch, because the refetch is what can fail.
      // Every member in this body is now persisted server-side whatever
      // happens next, so `handleRemove` must send a DELETE for any of them
      // even if `group` never catches up — see `locallySavedRef`'s docblock.
      body.members.forEach((m) => locallySavedRef.current.add(m.brandCode));
      toast.success(`บันทึก ${group.targetName} แล้ว`);
      // Awaited, not fire-and-forget (found in the final review). `busy`
      // (hence every trash button's `disabled`) stays true until this
      // resolves, so a click on a just-added-then-saved member's trash icon
      // cannot land while `persistedCodes` — derived from the `group` prop —
      // still reflects the pre-save state. Without the await, `setSaving(false)`
      // in `finally` ran the instant the POST resolved, re-enabling those
      // buttons a full round trip before the refetch this triggers actually
      // updated `group`; a click in that window took the "never saved, nothing
      // to delete" branch in `handleRemove` for a member that really was saved
      // — the exact no-DELETE bug this file's own history already fixed once.
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const bcLine = bcLineFor(group);
  const busy = saving || removingCode != null;

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={`${group.targetName} — Interface ERP`}
      contentClassName="max-w-4xl max-h-[90vh]"
      scrollable={false}
      uniformSurface
      hideTitle
    >
      <div className="flex flex-col min-h-0 max-h-[90vh]">
        <div className="shrink-0 px-6 pt-5 pb-3.5 pr-14" style={{ borderBottom: "1px solid var(--border-light)" }}>
          <div className="flex items-start gap-3">
            <div
              className="flex items-center justify-center shrink-0 rounded-xl p-2 mt-0.5"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
            >
              {group.targetLogo && (
                <img src={group.targetLogo} alt="" className="h-8 w-auto object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-bold m-0 leading-snug" style={{ color: "var(--text-heading)" }}>
                {group.targetName}
                <span className="font-normal" style={{ color: "var(--text-muted)" }}> — Interface ERP (AP-4)</span>
              </p>
              <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
                {group.targetCode} · {members.length} แบรนด์เบิก
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto dialog-scroll px-6 py-4">
          <div className="flex flex-col gap-4">
            <SettingsPanel className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-3" style={{ color: "var(--text-faint)" }}>
                ตั้งค่าร่วมกลุ่ม
              </p>
              <div className="min-w-0">
                <FieldLabel>Journal Batch</FieldLabel>
                <SearchableSelect
                  value={journalDraft}
                  onChange={setJournalDraft}
                  options={journalOpts}
                  placeholder={noErp ? erpUnavailableLabel : "— เลือก Journal Batch —"}
                  emptyLabel={noErp ? erpUnavailableLabel : "— เลือก Journal Batch —"}
                  searchPlaceholder="ค้นหา Journal Batch..."
                  triggerBackground="var(--bg-card)"
                  // `saveReimburseErpGroup`'s own docblock: an empty group
                  // saves nothing at all, including this field — the batch is
                  // fanned out per member, so there is nowhere to store one
                  // with zero members. Save is already disabled for the same
                  // reason (`saveDisabledReason`); leaving this field live
                  // would let an admin pick a value that Save then silently
                  // discards on close.
                  disabled={busy || members.length === 0}
                />
                <p className="text-[10px] m-0 mt-1.5" style={{ color: "var(--text-faint)" }}>
                  {members.length === 0
                    ? "เพิ่มแบรนด์เบิกอย่างน้อย 1 แบรนด์ก่อนจึงจะตั้งค่านี้ได้"
                    : "ใช้ร่วมทุกแบรนด์เบิกในกลุ่มนี้"}
                </p>
              </div>

              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-light)" }}>
                <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-faint)" }}>
                  การเชื่อมต่อ BC
                </p>
                <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                  {bcLine}{group.environment ? ` · ${group.environment === "Sandbox" ? "UAT" : "PROD"}` : ""}
                </p>
              </div>

              {!group.profileComplete && (
                <p className="text-[11px] m-0 mt-3 px-3 py-2 rounded-lg"
                  style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                  ตั้งค่าการเชื่อมต่อ BC ให้ครบที่ Settings → Brand Config หรือ Accounting → Interface ERP ก่อน
                </p>
              )}
            </SettingsPanel>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>
                    บัญชีแยกตามแบรนด์เบิก
                  </p>
                  {/*
                   * No G/L Account column and no Description column here, unlike
                   * AP-1's TargetErpGroupEditForm — see this component's own
                   * docblock above for why AP-4 has neither.
                   */}
                  <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                    Bank · Branch (+ Fix Dept) ตั้งแยกต่อแบรนด์
                  </p>
                </div>
                <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                  {members.length} แบรนด์
                </span>
              </div>

              <SettingsPanel>
                <div
                  className="hidden lg:grid items-end gap-3 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--text-faint)", gridTemplateColumns: MEMBER_ROW_GRID, background: "var(--bg-card)", borderBottom: "1px solid var(--border-light)" }}
                >
                  <span>แบรนด์เบิก</span>
                  <span>Bank Account</span>
                  <span>Branch Code</span>
                  <span className="sr-only">ลบ</span>
                </div>

                {members.length === 0 ? (
                  <p className="text-[12px] m-0 px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
                    ยังไม่มีแบรนด์เบิก — เพิ่มจากด้านล่าง
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {members.map((member, index) => {
                      const rowRemoving = removingCode === member.brandCode;
                      return (
                        <div
                          key={member.brandCode}
                          style={{ borderBottom: index < members.length - 1 ? "1px solid var(--border-light)" : undefined }}
                        >
                          {/* Mobile / tablet */}
                          <div className="lg:hidden p-3 space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <MemberBrandCell brandName={member.brandName} brandCode={member.brandCode} brandLogo={member.brandLogo} />
                              <button
                                type="button"
                                onClick={() => void handleRemove(member)}
                                disabled={busy}
                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg shrink-0"
                                style={{ color: "var(--text-muted)", border: "1px solid var(--border-light)", background: "var(--bg-card)" }}
                                title={`นำ ${member.brandName} ออกจากกลุ่ม`}
                              >
                                {rowRemoving ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold m-0 mb-1" style={{ color: "var(--text-faint)" }}>Bank Account</p>
                              <SearchableSelect
                                value={member.bankAccountNo}
                                onChange={(v) => updateMember(member.brandCode, { bankAccountNo: v })}
                                options={bankOpts}
                                placeholder={noErp ? erpUnavailableLabel : "— เลือก Bank —"}
                                emptyLabel={noErp ? erpUnavailableLabel : "— เลือก Bank —"}
                                searchPlaceholder="ค้นหา Bank..."
                                triggerBackground="var(--bg-card)"
                                disabled={busy}
                              />
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold m-0 mb-1" style={{ color: "var(--text-faint)" }}>Branch Code</p>
                              <SearchableSelect
                                value={member.branchCode}
                                onChange={(v) => handleBranchChange(member.brandCode, v)}
                                options={branchOpts}
                                placeholder={noErp ? erpUnavailableLabel : "— ไม่ระบุ · ใช้แผนกผู้ขอ —"}
                                emptyLabel={noErp ? erpUnavailableLabel : "— ไม่ระบุ · ใช้แผนกผู้ขอ —"}
                                searchPlaceholder="ค้นหา Branch..."
                                triggerBackground="var(--bg-card)"
                                wrapLabel
                                disabled={busy}
                              />
                              <FixDeptControl
                                branchCode={member.branchCode}
                                deptAsBranch={member.deptAsBranch}
                                fixedErpDeptCode={member.fixedErpDeptCode}
                                disabled={busy}
                                deptFailed={deptFailed}
                                onPick={() => setDeptPick({ brandCode: member.brandCode, branchCode: member.branchCode, initialCode: member.fixedErpDeptCode })}
                                onClear={() => updateMember(member.brandCode, { deptAsBranch: false, fixedErpDeptCode: "" })}
                              />
                            </div>
                          </div>

                          {/* Desktop */}
                          <div className="hidden lg:grid items-start gap-3 px-3 py-3" style={{ gridTemplateColumns: MEMBER_ROW_GRID }}>
                            <MemberBrandCell brandName={member.brandName} brandCode={member.brandCode} brandLogo={member.brandLogo} />
                            <SearchableSelect
                              value={member.bankAccountNo}
                              onChange={(v) => updateMember(member.brandCode, { bankAccountNo: v })}
                              options={bankOpts}
                              placeholder={noErp ? erpUnavailableLabel : "— เลือก Bank —"}
                              emptyLabel={noErp ? erpUnavailableLabel : "— เลือก Bank —"}
                              searchPlaceholder="ค้นหา Bank..."
                              triggerBackground="var(--bg-card)"
                              disabled={busy}
                            />
                            <div>
                              <SearchableSelect
                                value={member.branchCode}
                                onChange={(v) => handleBranchChange(member.brandCode, v)}
                                options={branchOpts}
                                placeholder={noErp ? erpUnavailableLabel : "— ไม่ระบุ · ใช้แผนกผู้ขอ —"}
                                emptyLabel={noErp ? erpUnavailableLabel : "— ไม่ระบุ · ใช้แผนกผู้ขอ —"}
                                searchPlaceholder="ค้นหา Branch..."
                                triggerBackground="var(--bg-card)"
                                wrapLabel
                                disabled={busy}
                              />
                              <FixDeptControl
                                branchCode={member.branchCode}
                                deptAsBranch={member.deptAsBranch}
                                fixedErpDeptCode={member.fixedErpDeptCode}
                                disabled={busy}
                                deptFailed={deptFailed}
                                onPick={() => setDeptPick({ brandCode: member.brandCode, branchCode: member.branchCode, initialCode: member.fixedErpDeptCode })}
                                onClear={() => updateMember(member.brandCode, { deptAsBranch: false, fixedErpDeptCode: "" })}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleRemove(member)}
                              disabled={busy}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg mx-auto mt-1 transition-colors hover:opacity-80"
                              style={{
                                color: "var(--text-muted)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-card)",
                                cursor: busy ? "not-allowed" : "pointer",
                                opacity: busy ? 0.5 : 1,
                              }}
                              title={`นำ ${member.brandName} ออกจากกลุ่ม`}
                            >
                              {rowRemoving ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  className="px-3 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5"
                  style={{ borderTop: "1px dashed var(--border-light)", background: "var(--bg-card)" }}
                >
                  <div className="flex items-center gap-1.5 shrink-0 sm:min-w-[7.5rem]">
                    <Plus size={14} style={{ color: "var(--nav-active-text)" }} />
                    <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>เพิ่มแบรนด์</span>
                  </div>
                  <div className="flex flex-1 min-w-0 items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        value={addCode}
                        onChange={setAddCode}
                        options={addOptions}
                        placeholder={addOptions.length === 0 ? "ไม่มีแบรนด์ว่าง" : "เลือกแบรนด์เบิก..."}
                        emptyLabel={addOptions.length === 0 ? "ไม่มีแบรนด์ว่าง" : "เลือกแบรนด์เบิก..."}
                        searchPlaceholder="ค้นหาแบรนด์..."
                        triggerBackground="var(--bg-card-alt)"
                        disabled={busy || addOptions.length === 0}
                      />
                    </div>
                    <Button type="button" variant="secondary" className="shrink-0" disabled={busy || !addCode} onClick={handleAdd}>
                      เพิ่ม
                    </Button>
                  </div>
                </div>
              </SettingsPanel>
            </div>
          </div>
        </div>

        <div
          className="shrink-0 px-6 py-4 flex flex-wrap items-center justify-between gap-3"
          style={{ borderTop: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}
        >
          <p className="text-[10px] m-0 flex items-center gap-1.5 max-w-[26rem]" style={{ color: saveDisabledReason ? "var(--text-info-yellow)" : "var(--text-faint)" }}>
            {saveDisabledReason ? (
              <>
                <Circle size={12} style={{ color: "var(--text-info-yellow)" }} />
                {saveDisabledReason}
              </>
            ) : (
              <>
                <CheckCircle2 size={12} style={{ color: "var(--text-info-green)" }} />
                พร้อมบันทึก
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
            <Button type="button" variant="primary" icon={<Save size={15} />} onClick={() => void handleSave()} loading={saving} disabled={!!saveDisabledReason || busy}>
              บันทึก
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              ปิด
            </Button>
          </div>
        </div>
      </div>

      {deptPick && (
        <ErpDeptFixDialog
          open
          onOpenChange={(open) => { if (!open) setDeptPick(null); }}
          targetBrandName={group.targetName}
          targetBrandCode={group.targetCode}
          branchCode={deptPick.branchCode}
          initialCode={deptPick.initialCode}
          departmentOptions={departmentOptions}
          onConfirm={(code) => {
            updateMember(deptPick.brandCode, { deptAsBranch: true, fixedErpDeptCode: code });
            setDeptPick(null);
          }}
        />
      )}
    </Dialog>
  );
}

/**
 * AP-4's Interface ERP tab — grouped by interface target since SDD Task 8,
 * the way AP-1's own tab groups (`BrandErpInterfaceSettings.tsx`). Reads
 * `/api/request/reimburse/settings/erp-interface` (Task 6's service, Task 7's
 * route — `requireRole` on every method, this tab is deliberately not
 * grantable, see `settings-tabs.ts`).
 *
 * Bank / Branch / Journal Batch option lists come from AP-2's existing
 * `/api/request/advance/settings/erp-master` — the same reuse the old flat
 * screen already made, since that endpoint reads `Rocks_ERP_Data` keyed by
 * Company and unrelated to which form is asking. Department options for Fix
 * Dept come from AP-1's admin-sync GET, `/api/request/accounting/settings/erp-accounts`
 * (no `brand`/`category` query — the batched shape) — reused rather than
 * duplicated for the same reason, and reachable here because this whole tab
 * is admin-only, and `requireSettingsTab`'s admin arm is exactly `requireRole`.
 *
 * **No Sync Vendor button, unlike AP-2's panel.** Vendor sync exists so AP-2's
 * Dr line can match a Business Central vendor at send time; AP-4 has no send
 * path yet at all, so there is nothing here for a synced vendor list to serve.
 *
 * **No brand Active toggle, unlike AP-2's panel.** AP-4 already has its own
 * "แบรนด์ที่เบิกได้" tab (`ReimburseBrandSettings`) that owns the complete
 * active set through `/api/request/reimburse/settings/brands`. Toggling a
 * brand from here too, through a second per-brand endpoint, would be a second
 * way to change the same flag.
 */
export function ReimburseErpInterfaceSettings() {
  const { data, error, mutate, isLoading } = useSWR<{ ok: boolean; data?: ReimburseErpGroupsView }>(
    ERP_INTERFACE_URL,
    fetcher,
  );
  const { data: erpData, error: erpError, isLoading: erpLoading, mutate: mutateErp } =
    useSWR<{ ok: boolean; data?: Record<string, CompanyErp> }>(
      "/api/request/advance/settings/erp-master",
      fetcher,
    );
  const { data: deptData, error: deptError, isLoading: deptLoading, mutate: mutateDept } =
    useSWR<{ ok: boolean; data?: Record<string, CompanyDept> }>(
      "/api/request/accounting/settings/erp-accounts",
      fetcher,
    );

  const view = data?.data;
  const groups = useMemo(() => view?.groups ?? [], [view]);
  const unassigned = useMemo(() => view?.unassigned ?? [], [view]);
  const erpByCompany = erpData?.data ?? {};
  const deptByCompany = deptData?.data ?? {};
  // I6 (final review): these two fetches used to carry no failure state at
  // all — a 500 rendered identically to "Business Central genuinely has no
  // accounts" / "no departments". `erpFailed` feeds the modal's per-field
  // placeholder text (`erpUnavailableLabel`); `deptFailed` feeds the Fix Dept
  // control the same way, both distinguishing "the request failed" from "this
  // company/branch really has nothing" — only one of those is fixed by
  // retrying.
  const erpFailed = !erpLoading && !!erpError;
  const deptFailed = !deptLoading && !!deptError;

  const [editTargetCode, setEditTargetCode] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Refetch all three, swallowing whatever they throw.
   *
   * `handleSave` inside the modal now AWAITS this (I6, final review) so
   * `busy` — and every trash button's `disabled` — stays true until the
   * post-save refetch has actually landed, not merely until the POST itself
   * resolved; see that function's own comment for the race this closes. A
   * rejection here must never propagate into `handleSave`'s `catch`, which
   * would misreport a successful save as a failed one — the SWR `error` state
   * each hook already carries is what `failed`/`erpFailed`/`deptFailed` below
   * render off, so nothing is lost by swallowing it here too.
   */
  const load = async () => {
    try {
      await Promise.all([mutate(), mutateErp(), mutateDept()]);
    } catch {
      // Intentionally swallowed — see the comment above.
    }
  };

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([mutate(), mutateErp(), mutateDept()]);
      toast.success("รีเฟรชข้อมูลแล้ว");
    } catch {
      toast.error("รีเฟรชไม่สำเร็จ");
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * The last group `editTargetCode` resolved to, kept alive across a failed
   * refetch.
   *
   * Found in the final review: `editGroup` used to be `groups.find(...) ??
   * null` alone, with nothing guarding the moment `groups` reads empty. The
   * likeliest trigger was the admin's own Save: POST succeeds → `onSaved()`
   * → the GET refetch it triggers fails → `groups` reads `[]` for that
   * render → `editGroup` becomes `null` → the modal (which renders on
   * `editGroup` below) unmounts, silently, with every unsaved edit in it.
   * `fetcher` now rejects rather than resolving on a failed response (see its
   * own comment), which already keeps SWR's `data` from being clobbered by a
   * `{ ok: false }` body in the common case — this ref is the belt-and-braces
   * half: it only ever updates to a REAL match, never to `null` while a group
   * is still open, so nothing about SWR's own retry/caching behaviour is what
   * this modal's survival depends on.
   */
  const lastKnownGroupRef = useRef<ReimburseErpGroup | null>(null);
  useEffect(() => {
    if (!editTargetCode) {
      lastKnownGroupRef.current = null;
      return;
    }
    const match = groups.find((g) => g.targetCode === editTargetCode);
    if (match) lastKnownGroupRef.current = match;
  }, [editTargetCode, groups]);

  const editGroup = editTargetCode
    ? groups.find((g) => g.targetCode === editTargetCode) ?? lastKnownGroupRef.current
    : null;
  const loading = isLoading && !view;
  /**
   * A failed read must never render as an empty one.
   *
   * `fetcher` throws on a non-2xx status or a resolved `{ ok: false }` body
   * (see its own comment) — before that fix it resolved normally for either,
   * so a 500 or a 403 arrived as `data = { ok: false }` with SWR's `error`
   * unset, `view` undefined, and `groups` empty. Without this branch
   * `nothingConfigured` is vacuously true and the screen tells an admin there
   * are no AP-4 brands, sending them to fix a tab that is not the problem,
   * with รีเฟรช disabled so they cannot even retry. The `(!!data && !data.ok)`
   * arm is now mostly a defensive fallback — the throwing fetcher means SWR
   * should never actually store such a `data` — but costs nothing to keep.
   * This is the exact failure CLAUDE.md records for the API-key change log
   * ("A failed read of the change log must never render as an empty one"),
   * which had the same two-arm shape.
   */
  const failed = !loading && (!!error || (!!data && !data.ok));
  const nothingConfigured =
    !loading && !failed && groups.every((g) => g.members.length === 0) && unassigned.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl px-4 py-3 flex flex-wrap items-start justify-between gap-3"
        style={{ background: "var(--nav-active-bg)", border: "1px solid var(--border-card)" }}>
        <div className="flex-1 min-w-[200px]">
          <p className="text-[13px] font-semibold m-0 flex items-center gap-1.5" style={{ color: "var(--text-heading)" }}>
            <Link2 size={15} style={{ color: "var(--nav-active-text)" }} /> Interface ERP (AP-4)
          </p>
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            จัดกลุ่มตาม Company ปลายทาง — Bank · Branch · Journal Batch ดึงจาก Rocks_ERP_Data —
            การตั้งค่านี้เป็นการเตรียมข้อมูลไว้ล่วงหน้า AP-4 ยังไม่มีขั้นตอนส่งเข้า Business Central
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            icon={<RefreshCw size={15} className={refreshing || erpLoading ? "animate-spin" : ""} />}
            onClick={() => void refresh()}
            loading={refreshing}
            // Only while the first load is in flight. It used to be `!view`,
            // which disabled the one control that could recover from a failed
            // read — exactly when a retry is what the admin wants.
            disabled={loading}
          >
            รีเฟรช
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : failed ? (
        <div className="py-8 text-center">
          <p className="text-[13px] m-0" style={{ color: "var(--text-danger)" }}>
            โหลดการตั้งค่า Interface ERP ไม่สำเร็จ
          </p>
          <p className="text-[12px] mt-1.5 m-0" style={{ color: "var(--text-muted)" }}>
            นี่ไม่ได้แปลว่ายังไม่ได้ตั้งค่า — กด “รีเฟรช” เพื่อลองใหม่
          </p>
        </div>
      ) : nothingConfigured ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
          ยังไม่มีแบรนด์ที่เบิกได้สำหรับ AP-4 (ตั้งค่าที่แท็บ “แบรนด์ที่เบิกได้”)
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groups.map((group) => (
              <ReimburseErpGroupCard key={group.targetCode} group={group} onEdit={() => setEditTargetCode(group.targetCode)} />
            ))}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-2" style={{ color: "var(--text-faint)" }}>
              ยังไม่ได้จัดกลุ่ม
            </p>
            {unassigned.length === 0 ? (
              <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                ทุกแบรนด์เบิกได้ถูกจัดกลุ่มแล้ว
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {unassigned.map((row) => (
                    <UnassignedBrandChip key={row.brandCode} row={row} />
                  ))}
                </div>
                <p className="text-[10px] m-0 mt-2" style={{ color: "var(--text-faint)" }}>
                  เพิ่มแบรนด์เหล่านี้เข้ากลุ่มจากปุ่ม “แก้ไข” บนกลุ่มปลายทางที่ต้องการ
                </p>
              </>
            )}
          </div>
        </>
      )}

      {editGroup && (
        <ReimburseErpGroupModal
          key={editGroup.targetCode}
          group={editGroup}
          unassigned={unassigned}
          erp={erpByCompany[editGroup.targetCode]}
          erpFailed={erpFailed}
          departmentOptions={deptByCompany[editGroup.targetCode]?.department ?? []}
          deptFailed={deptFailed}
          onClose={() => setEditTargetCode(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
