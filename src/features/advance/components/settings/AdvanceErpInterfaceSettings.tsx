"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { CheckCircle2, Circle, Link2, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

interface ConfigRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  targetFromAp2: boolean;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  branchCode: string | null;
  glAccountNo: string | null;
  bankAccountNo: string | null;
  journalBatchName: string | null;
  ready: boolean;
}

type SelectOption = { value: string; label: string; subLabel?: string };
interface AcctOpt { accountNo: string; displayName: string | null }
interface BatchOpt { batchName: string; displayName: string | null; templateName: string | null }
interface BranchOpt { code: string; displayName: string | null }
interface CompanyErp { gl: AcctOpt[]; bank: AcctOpt[]; journalBatch: BatchOpt[]; branch: BranchOpt[] }

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Journal Batch → AP-2's own env-aware cache; G/L·Bank·Branch → AP-1's shared
// erp-accounts sync (Fast_Data) that AP-2's dropdowns read.
const SYNC_PHASES = [
  { key: "journalBatch", label: "Journal Batch" },
  { key: "gl", label: "G/L Account" },
  { key: "bank", label: "Bank Account" },
  { key: "branch", label: "Branch" },
] as const;
type PhaseKey = (typeof SYNC_PHASES)[number]["key"];

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

function ReadonlyField({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = !value?.trim() || value === "—";
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>{label}</p>
      <p className="text-[12px] m-0 truncate font-medium"
        style={{ color: empty ? "var(--text-muted)" : "var(--text-primary)" }} title={value ?? ""}>
        {empty ? "—" : value}
      </p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>{children}</p>;
}

function StatusBadge({ ready }: { ready: boolean }) {
  const Icon = ready ? CheckCircle2 : Circle;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={ready
        ? { background: "rgba(79,163,122,0.15)", color: "var(--text-info-green)" }
        : { background: "var(--bg-badge)", color: "var(--text-muted)" }}>
      <Icon size={12} />{ready ? "พร้อมส่ง" : "ยังไม่ครบ"}
    </span>
  );
}

function BrandCard({ row, erpByCompany, onSaved }: {
  row: ConfigRow;
  erpByCompany: Record<string, CompanyErp>;
  onSaved: () => void;
}) {
  // Company is inherited from AP-1 (read-only).
  // AP-2 owns G/L + Bank + Branch + Journal Batch.
  const target = row.interfaceTarget ?? "";
  const [gl, setGl] = useState(row.glAccountNo ?? "");
  const [bank, setBank] = useState(row.bankAccountNo ?? "");
  const [branch, setBranch] = useState(row.branchCode ?? "");
  const [batch, setBatch] = useState(row.journalBatchName ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  const erp = erpByCompany[target];
  const glOpts = useMemo(() => acctOptions(erp?.gl ?? [], gl), [erp, gl]);
  const bankOpts = useMemo(() => acctOptions(erp?.bank ?? [], bank), [erp, bank]);
  const branchOpts = useMemo(() => branchOptions(erp?.branch ?? [], branch), [erp, branch]);
  // Journal batches are read LIVE from the env AP-2 posts to (Sandbox/Prod) —
  // the synced list is Production-only and can offer batches missing in Sandbox.
  // The "Sync Batch" button lives in the section header (syncs every Company).
  const { data: liveBatch, isLoading: batchLoading } = useSWR<{ ok: boolean; error?: string; data?: { environment: string | null; batches: BatchOpt[] } }>(
    target ? `/api/request/advance/settings/erp-batches?company=${encodeURIComponent(target)}` : null,
    fetcher,
  );
  const batchEnv = liveBatch?.data?.environment ?? null;
  const batchErr = liveBatch && !liveBatch.ok ? (liveBatch.error ?? "ดึง batch ไม่สำเร็จ") : null;
  const batchOpts = useMemo(() => batchOptions(liveBatch?.data?.batches ?? [], batch), [liveBatch, batch]);

  const glDirty = gl.trim() !== (row.glAccountNo ?? "").trim();
  const bankDirty = bank.trim() !== (row.bankAccountNo ?? "").trim();
  const branchDirty = branch.trim() !== (row.branchCode ?? "").trim();
  const batchDirty = batch.trim() !== (row.journalBatchName ?? "").trim();

  async function saveAll() {
    if (!gl.trim()) return toast.error("กรุณาเลือก G/L Account");
    if (!bank.trim()) return toast.error("กรุณาเลือก Bank Account");
    setBusy("all");
    try {
      const res = await fetch("/api/request/advance/settings/erp-interface", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandCode: row.brandCode,
          glAccountNo: gl.trim(),
          bankAccountNo: bank.trim(),
          branchCode: branch.trim(),
          journalBatchName: batch.trim(),
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      toast.success(`บันทึกการตั้งค่า ${row.brandName} แล้ว`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  const noOpts = !erp;
  const bcLine = [decode(row.bcName), row.bcConnectionName?.trim()].filter((v) => v && v !== "—").join(" · ") || "—";
  const anyDirty = glDirty || bankDirty || branchDirty || batchDirty;

  return (
    <div className="rounded-xl p-4"
      style={{
        background: anyDirty ? "var(--bg-info-yellow)" : "var(--bg-card-alt)",
        border: `1px solid ${anyDirty ? "var(--border-info-yellow)" : row.ready ? "var(--border-info-green)" : "var(--border-card)"}`,
      }}>
      {/* header */}
      <div className="flex items-center gap-3 mb-3">
        {row.brandLogo && (
          <img src={row.brandLogo} alt="" className="h-8 w-auto object-contain shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>{row.brandName}</p>
          <p className="text-[10px] m-0 font-mono" style={{ color: "var(--text-muted)" }}>
            {row.brandCode} → {target || "—"} · (จาก AP-1)
            {row.environment ? ` · ${row.environment === "Sandbox" ? "UAT" : "PROD"}` : ""}
          </p>
        </div>
        <StatusBadge ready={row.ready} />
      </div>

      {/* inherited from AP-1 (read-only) */}
      <div className="mb-3 pb-3" style={{ borderBottom: "1px solid var(--border-light)" }}>
        <ReadonlyField label="Company (BC)" value={bcLine} />
      </div>
      {target && !row.bcProfileComplete && (
        <p className="text-[11px] m-0 mb-3 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
          ⚠️ การเชื่อมต่อ BC ของ Company นี้ยังไม่ครบ — ตั้งค่าที่ Accounting → Interface ERP ก่อน
        </p>
      )}

      {/* editable: G/L + Bank + Branch + Journal Batch — one Save button per Company */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="min-w-0">
          <FieldLabel>G/L Account (AP-2)</FieldLabel>
          <SearchableSelect
            value={gl}
            onChange={setGl}
            options={glOpts}
            placeholder={noOpts ? "เลือกปลายทาง / Sync ERP ก่อน" : "— เลือก G/L —"}
            emptyLabel={noOpts ? "เลือกปลายทาง / Sync ERP ก่อน" : "— เลือก G/L —"}
            searchPlaceholder="ค้นหา G/L..."
            triggerBackground="var(--bg-card)"
          />
        </div>
        <div className="min-w-0">
          <FieldLabel>Bank Account (AP-2)</FieldLabel>
          <SearchableSelect value={bank} onChange={setBank} options={bankOpts}
            placeholder={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Bank —"}
            emptyLabel={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Bank —"}
            searchPlaceholder="ค้นหา Bank..." triggerBackground="var(--bg-card)" />
        </div>
        <div className="min-w-0">
          <FieldLabel>Branch (AP-2)</FieldLabel>
          <SearchableSelect value={branch} onChange={setBranch} options={branchOpts}
            placeholder={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Branch —"}
            emptyLabel={noOpts ? "เลือกปลายทางก่อน" : "— เลือก Branch —"}
            searchPlaceholder="ค้นหา Branch..." triggerBackground="var(--bg-card)" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Journal Batch · PAYMENTS</span>
            {batchEnv && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={batchEnv === "Production"
                  ? { background: "#dc262618", color: "#dc2626" }
                  : { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)" }}>
                {batchEnv === "Production" ? "Production" : "Sandbox"}
              </span>
            )}
          </div>
          <SearchableSelect value={batch} onChange={setBatch} options={batchOpts}
            placeholder={!target ? "ไม่มีปลายทาง" : batchOpts.length === 0 ? "ไม่พบ batch (PAYMENTS)" : "— เลือก Batch —"}
            emptyLabel={!target ? "ไม่มีปลายทาง" : "— เลือก Batch —"}
            searchPlaceholder="ค้นหา Batch..." triggerBackground="var(--bg-card)" />
          {target && batchErr ? (
            <p className="text-[10px] m-0 mt-0.5" style={{ color: "#dc2626" }}>⚠️ {batchErr}</p>
          ) : target && !batchLoading && batchOpts.length === 0 ? (
            <p className="text-[10px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              ไม่มี Journal Batch (Template PAYMENTS) ใน {batchEnv === "Production" ? "Production" : "Sandbox"} ของ {target} — สร้างใน BC ก่อน
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mt-3 pt-3"
        style={{ borderTop: "1px solid var(--border-light)" }}>
        <p className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
          AP-2 กำหนดเอง: G/L · Bank · Branch · Journal Batch — ส่วน Company ใช้ร่วมกับ AP-1
        </p>
        <Button variant="primary" icon={<Save size={15} />} onClick={saveAll}
          loading={busy === "all"} disabled={!anyDirty}>บันทึก</Button>
      </div>
    </div>
  );
}

export function AdvanceErpInterfaceSettings() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/settings/erp-interface")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: ConfigRow[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  // ERP-synced G/L / Bank / Journal-Batch options, keyed by Company (interface target).
  const { data: erpData } = useSWR<{ ok: boolean; data?: Record<string, CompanyErp> }>(
    "/api/request/accounting/settings/erp-accounts",
    fetcher,
  );
  const erpByCompany = erpData?.data ?? {};

  const { mutate } = useSWRConfig();
  const [syncing, setSyncing] = useState(false);
  const [phases, setPhases] = useState<Record<PhaseKey, boolean>>({
    journalBatch: true, gl: true, bank: true, branch: true,
  });
  const activePhases = SYNC_PHASES.filter((p) => phases[p.key]);
  const allSel = activePhases.length === SYNC_PHASES.length;
  const someSel = activePhases.length > 0 && !allSel;
  const setAllPhases = (v: boolean) => setPhases({ journalBatch: v, gl: v, bank: v, branch: v });

  // Sync the data AP-2's dropdowns read: Journal Batch via AP-2's env-aware cache,
  // G/L·Bank·Branch via AP-1's shared erp-accounts sync — then revalidate both.
  async function syncErp() {
    const targets = Array.from(new Set(rows.map((r) => r.interfaceTarget).filter(Boolean)));
    if (targets.length === 0 || activePhases.length === 0) return;
    setSyncing(true);
    const counts = { gl: 0, bank: 0, branch: 0, batchSandbox: 0, batchProduction: 0 };
    const errors: string[] = [];
    try {
      for (const p of activePhases) {
        for (const company of targets) {
          try {
            if (p.key === "journalBatch") {
              const res = await fetch("/api/request/advance/settings/erp-batches", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company }),
              });
              const j = (await res.json()) as { ok: boolean; error?: string; data?: { sandbox: number; production: number; errors: string[] } };
              if (!j.ok) { errors.push(`${company} (Batch): ${j.error ?? "sync ไม่สำเร็จ"}`); continue; }
              counts.batchSandbox += j.data?.sandbox ?? 0;
              counts.batchProduction += j.data?.production ?? 0;
              if (j.data?.errors?.length) errors.push(...j.data.errors);
            } else {
              const res = await fetch("/api/request/accounting/settings/erp-accounts/sync", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandCode: company, phase: p.key }),
              });
              const j = (await res.json()) as { ok: boolean; error?: string; data?: { glRows: number; bankRows: number; branchRows: number } };
              if (!j.ok) { errors.push(`${company} (${p.label}): ${j.error ?? "sync ไม่สำเร็จ"}`); continue; }
              counts.gl += j.data?.glRows ?? 0;
              counts.bank += j.data?.bankRows ?? 0;
              counts.branch += j.data?.branchRows ?? 0;
            }
          } catch (e) {
            errors.push(`${company} (${p.label}): ${e instanceof Error ? e.message : "error"}`);
          }
        }
      }
      const parts: string[] = [];
      if (phases.gl) parts.push(`G/L ${counts.gl}`);
      if (phases.bank) parts.push(`Bank ${counts.bank}`);
      if (phases.branch) parts.push(`Branch ${counts.branch}`);
      if (phases.journalBatch) parts.push(`Batch(S ${counts.batchSandbox}/P ${counts.batchProduction})`);
      toast.success(`Sync เสร็จ: ${parts.join(" · ")}`);
      errors.forEach((e) => toast.error(e));
      await Promise.all([
        mutate("/api/request/accounting/settings/erp-accounts"),
        mutate((key) => typeof key === "string" && key.startsWith("/api/request/advance/settings/erp-batches")),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "sync ไม่สำเร็จ");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl px-4 py-3 flex flex-wrap items-start justify-between gap-3"
        style={{ background: "var(--nav-active-bg)", border: "1px solid var(--border-card)" }}>
        <div className="flex-1 min-w-[200px]">
          <p className="text-[13px] font-semibold m-0 flex items-center gap-1.5" style={{ color: "var(--text-heading)" }}>
            <Link2 size={15} style={{ color: "var(--nav-active-text)" }} /> Interface ERP (AP-2)
          </p>
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            AP-2 กำหนด G/L · Bank · Branch · Journal Batch ต่อแบรนด์ — Company ใช้ร่วมกับ AP-1
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2.5">
            <span className="text-[10px] font-semibold shrink-0" style={{ color: "var(--text-muted)" }}>Sync:</span>
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none"
              style={{ color: allSel || someSel ? "var(--text-secondary)" : "var(--text-faint)" }}>
              <input ref={(el) => { if (el) el.indeterminate = someSel; }} type="checkbox" checked={allSel} disabled={syncing}
                onChange={(e) => setAllPhases(e.target.checked)} className="rounded cursor-pointer" style={{ accentColor: "var(--nav-active-text)" }} />
              <span className="text-[11px] font-bold">All</span>
            </label>
            <span className="w-px h-3.5 shrink-0" style={{ background: "var(--border-card)" }} aria-hidden />
            {SYNC_PHASES.map(({ key, label }) => (
              <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer select-none"
                style={{ color: phases[key] ? "var(--text-secondary)" : "var(--text-faint)" }}>
                <input type="checkbox" checked={phases[key]} disabled={syncing}
                  onChange={(e) => setPhases((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="rounded cursor-pointer" style={{ accentColor: "var(--nav-active-text)" }} />
                <span className="text-[11px] font-medium">{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            icon={<RefreshCw size={15} className={syncing ? "animate-spin" : ""} />}
            onClick={() => void syncErp()}
            loading={syncing}
            disabled={rows.length === 0 || activePhases.length === 0}
          >
            Sync ERP
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
          ยังไม่มีแบรนด์ที่ map Company (ตั้งค่าที่ Accounting → Interface ERP)
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <BrandCard key={r.brandCode} row={r} erpByCompany={erpByCompany} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}
