"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, Circle, Save } from "lucide-react";
import { Button } from "@/components/ui";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

interface ViewRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  journalBatchName: string | null;
  vatInputGlAccountNo: string | null;
  whtPayableGlAccountNo: string | null;
  ready: boolean;
  active: boolean;
}
interface BatchOpt { batchName: string; displayName: string | null; templateName: string | null }
interface GlOpt { accountNo: string; displayName: string | null }
type SelectOption = { value: string; label: string; subLabel?: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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

function glOptions(items: GlOpt[], current?: string | null): SelectOption[] {
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

function ReadonlyField({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = !value?.trim();
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>{label}</p>
      <p className="text-[12px] m-0 truncate font-medium" title={value ?? ""}
        style={{ color: empty ? "var(--text-muted)" : "var(--text-primary)" }}>{empty ? "—" : value}</p>
    </div>
  );
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

function BrandCard({ row, onSaved }: { row: ViewRow; onSaved: () => void }) {
  const target = row.interfaceTarget ?? "";
  const [batch, setBatch] = useState(row.journalBatchName ?? "");
  const [vatGl, setVatGl] = useState(row.vatInputGlAccountNo ?? "");
  const [whtGl, setWhtGl] = useState(row.whtPayableGlAccountNo ?? "");
  const [busy, setBusy] = useState(false);

  // Journal batches for the target Company AP-3 inherits from AP-2 (interfaceTarget)
  // — keyed by that Company so the list always matches the Company on the card.
  const { data: liveBatch, isLoading } = useSWR<{ ok: boolean; error?: string; data?: BatchOpt[] }>(
    target ? `/api/request/clear-advance/settings/erp-journal-batches?company=${encodeURIComponent(target)}` : null,
    fetcher,
  );
  // GL accounts for the claim brand (brand drives the chart of accounts scope)
  const { data: liveGl, isLoading: glLoading } = useSWR<{ ok: boolean; data?: GlOpt[] }>(
    row.brandCode ? `/api/request/clear-advance/settings/erp-gl-accounts?brand=${encodeURIComponent(row.brandCode)}` : null,
    fetcher,
  );
  const batchEnv = row.environment;
  const batchErr = liveBatch && !liveBatch.ok ? (liveBatch.error ?? "ดึง batch ไม่สำเร็จ") : null;
  const opts = useMemo(() => batchOptions(liveBatch?.data ?? [], batch), [liveBatch, batch]);
  const vatOpts = useMemo(() => glOptions(liveGl?.data ?? [], vatGl), [liveGl, vatGl]);
  const whtOpts = useMemo(() => glOptions(liveGl?.data ?? [], whtGl), [liveGl, whtGl]);
  const dirty =
    batch.trim() !== (row.journalBatchName ?? "").trim() ||
    vatGl.trim() !== (row.vatInputGlAccountNo ?? "").trim() ||
    whtGl.trim() !== (row.whtPayableGlAccountNo ?? "").trim();

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/request/clear-advance/settings/erp-interface", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandCode: row.brandCode,
          journalBatchName: batch.trim(),
          vatInputGlAccountNo: vatGl.trim() || null,
          whtPayableGlAccountNo: whtGl.trim() || null,
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      toast.success(`บันทึกการตั้งค่า ERP ของ ${row.brandName} แล้ว`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {row.brandLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.brandLogo} alt="" className="h-6 w-auto object-contain" />
          )}
          <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-heading)" }}>{row.brandName}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>{row.brandCode}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={row.active
              ? { background: "rgba(79,163,122,0.15)", color: "var(--text-info-green)" }
              : { background: "var(--bg-badge)", color: "var(--text-muted)" }}>
            {row.active ? "Active" : "Inactive"}
          </span>
          <StatusBadge ready={row.ready} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <ReadonlyField label="ส่งเข้าแบรนด์ (Company)" value={row.interfaceTarget} />
        <ReadonlyField label="BC / Connection" value={row.bcName ?? row.bcConnectionName} />
        <ReadonlyField label="Environment" value={batchEnv} />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>Journal Batch *</p>
        <SearchableSelect
          value={batch}
          onChange={setBatch}
          options={opts}
          disabled={busy || isLoading}
          placeholder={isLoading ? "กำลังโหลด batch..." : "เลือก Journal Batch"}
          emptyLabel="— ไม่ระบุ —"
        />
        {batchErr && <p className="text-[11px] m-0" style={{ color: "var(--color-danger)" }}>{batchErr}</p>}
        {!isLoading && !batchErr && opts.length === 0 && (
          <p className="text-[11px] m-0" style={{ color: "var(--text-info-yellow)" }}>
            ไม่พบ Journal Batch ของแบรนด์นี้ใน ERP (sync ErpGeneralJournalBatch ก่อน)
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>ภาษีซื้อ (VAT input)</p>
        <SearchableSelect
          value={vatGl}
          onChange={setVatGl}
          options={vatOpts}
          disabled={busy || glLoading}
          placeholder={glLoading ? "กำลังโหลดบัญชี..." : "เลือกบัญชีภาษีซื้อ"}
          emptyLabel="— ไม่ระบุ —"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>WHT payable</p>
        <SearchableSelect
          value={whtGl}
          onChange={setWhtGl}
          options={whtOpts}
          disabled={busy || glLoading}
          placeholder={glLoading ? "กำลังโหลดบัญชี..." : "เลือกบัญชี WHT payable"}
          emptyLabel="— ไม่ระบุ —"
        />
      </div>

      <div className="flex justify-end">
        <Button variant="primary" size="sm" icon={<Save size={14} />}
          onClick={save} loading={busy} disabled={!dirty || busy}>บันทึก</Button>
      </div>
    </div>
  );
}

/** AP-3 Interface ERP — per-brand Journal Batch for the clearing journal. Company /
 *  G/L / bank / branch are inherited from the cleared AP-2 entries (read-only). */
export function ClrErpInterfaceSettings() {
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data?: ViewRow[] }>(
    "/api/request/clear-advance/settings/erp-interface", fetcher,
  );
  const rows = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] m-0 mb-2" style={{ color: "var(--text-muted)" }}>
        สถานะ Active จัดการที่หน้า AP-2 → ตั้งค่า → Interface ERP (ใช้ร่วมกัน)
      </p>
      <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
        AP-3 กลับรายการจาก AP-2 → G/L · ธนาคาร · สาขา มาจากรายการที่เคลียร์เอง
        ตั้งค่าที่นี่: <b>Journal Batch</b> · บัญชี<b>ภาษีซื้อ (VAT input)</b> · บัญชี<b>WHT payable</b> ที่รายการเคลียร์จะลง (Company สืบทอดจาก AP-2)
      </p>
      {isLoading ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
          ยังไม่มีแบรนด์ที่ตั้งค่า target ERP (ตั้งที่ AP-1/AP-2 Interface ก่อน)
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((r) => <BrandCard key={r.brandCode} row={r} onSaved={() => mutate()} />)}
        </div>
      )}
    </div>
  );
}
