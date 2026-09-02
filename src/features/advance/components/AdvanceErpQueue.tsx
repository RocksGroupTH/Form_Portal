"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Upload, FileText, Search, Download, Eye, Loader2 } from "lucide-react";
import { PaymentDatePicker } from "@/components/ui/PaymentDatePicker";
import { AdvanceCompanyBar, ADVANCE_COMPANY_ALL } from "./AdvanceCompanyBar";
import { AdvanceDetailPanel } from "./AdvanceDetailPanel";
import { AdvanceJournalPreview, type PreviewItem } from "./AdvanceJournalPreview";
import { FilterMonthPicker } from "@/features/accounting/components/FilterMonthPicker";
import { sentMonthKey } from "@/features/accounting/components/ApprovalQueueFilters";

interface ErpRow {
  id: number;
  requestNo: string | null;
  interfaceTarget: string;
  payeeName: string | null;
  currency: string | null;
  amount: number | null;
  baseAmount: number | null;
  paymentDate: string | null;
  erpInterfaceStatus: string | null;
  erpInterfaceError: string | null;
  erpInterfaceSentAt: string | null;
  erpInterfaceEnvironment: string | null;
  erpDocumentNo: string | null;
  matchedVendorNo: string | null;
  matchedVendorName: string | null;
}

type TabKey = "pending" | "sent";
type StatusFilter = "ALL" | "Sent" | "Pending" | "Failed";

function fmt(n: number): string {
  return Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  // Gregorian, like the rest of AP-2 — plain "th-TH" would print 2026 as 69.
  return d.toLocaleString("th-TH-u-ca-gregory", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Approved advances not yet sent to BC — the ones the preview lists. */
const SENDABLE = (r: ErpRow) => r.erpInterfaceStatus !== "Sent" && r.erpInterfaceStatus !== "Pending";

function SentBadge({ status, error }: { status: string | null; error: string | null }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    Sent: { label: "ส่งแล้ว", bg: "#16a34a22", fg: "#16a34a" },
    Pending: { label: "กำลังส่ง", bg: "#f59e0b22", fg: "#b45309" },
    Failed: { label: "ล้มเหลว", bg: "#dc262622", fg: "#dc2626" },
  };
  const s = status ? map[status] : null;
  if (!s) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
    style={{ background: "color-mix(in srgb, var(--nav-active-text) 10%, transparent)", color: "var(--nav-active-text)" }}>พร้อมส่ง</span>;
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" title={error ?? undefined}
      style={{ background: s.bg, color: s.fg }}>{s.label}</span>
  );
}

export function AdvanceErpQueue() {
  const [rows, setRows] = useState<ErpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<string>(ADVANCE_COMPANY_ALL);
  const [busy, setBusy] = useState(false);
  const [panelId, setPanelId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("pending");
  // sent-tab filters
  const [sentMonth, setSentMonth] = useState<string>("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [exporting, setExporting] = useState(false);
  // The id set frozen when the confirm dialog opens — sent verbatim so the server
  // posts exactly what the popup showed (or 409s on drift).
  const [frozenIds, setFrozenIds] = useState<number[]>([]);
  // Payment-date options for the per-row "รอส่ง" picker (loaded once).
  const [paymentDateOpts, setPaymentDateOpts] = useState<string[]>([]);
  // Pull-back ("ดึงกลับเพื่อยิงใหม่") confirm state.
  const [pullbackId, setPullbackId] = useState<number | null>(null);
  const [pullbackBusy, setPullbackBusy] = useState(false);
  // Checkbox selection state.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/request/advance/payment-dates")
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: { dates?: string[] } }) => { if (j?.data?.dates) setPaymentDateOpts(j.data.dates); })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/erp-queue")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: ErpRow[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.interfaceTarget] = (c[r.interfaceTarget] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(
    () => (company === ADVANCE_COMPANY_ALL ? rows : rows.filter((r) => r.interfaceTarget === company)),
    [rows, company],
  );

  const sendable = useMemo(() => filtered.filter(SENDABLE), [filtered]);
  const sentAll = useMemo(() => filtered.filter((r) => !SENDABLE(r)), [filtered]);

  // Checkbox selection helpers.
  const selectableIds = useMemo(() => sendable.map((r) => r.id), [sendable]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const selectedIds = useMemo(
    () => Array.from(selected).filter((id) => selectableIds.includes(id)),
    [selected, selectableIds],
  );

  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const toggleAll = useCallback(() => {
    setSelected(() => allSelected ? new Set() : new Set(selectableIds));
  }, [allSelected, selectableIds]);

  // Clear stale preview when selection changes.
  const selectedKey = useMemo(() => Array.from(selected).sort((a, b) => a - b).join(","), [selected]);
  useEffect(() => { setPreview([]); }, [selectedKey]);

  // Sent history is scoped to the month it was sent (AP-1 parity) so it never grows unbounded.
  const sentMonthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of sentAll) {
      if (r.erpInterfaceStatus !== "Sent") continue;
      const k = sentMonthKey(r.erpInterfaceSentAt);
      if (k) set.add(k);
    }
    return Array.from(set).sort().reverse();
  }, [sentAll]);

  useEffect(() => {
    if (sentMonthOptions.length === 0) { setSentMonth((p) => (p === "" ? p : "")); return; }
    setSentMonth((p) => (p && sentMonthOptions.includes(p) ? p : sentMonthOptions[0]));
  }, [sentMonthOptions]);

  // Sent-tab rows after all filters (status, month on Sent, text search).
  const sentFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sentAll.filter((r) => {
      if (statusFilter !== "ALL" && r.erpInterfaceStatus !== statusFilter) return false;
      if (sentMonth && r.erpInterfaceStatus === "Sent" && sentMonthKey(r.erpInterfaceSentAt) !== sentMonth) return false;
      if (q && !`${r.requestNo ?? ""} ${r.payeeName ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sentAll, statusFilter, sentMonth, search]);

  const readyIds = useMemo(() => preview.filter((p) => p.ok).map((p) => p.id), [preview]);
  const notReady = selectedIds.length - readyIds.length;

  // Per-Company summary of what the send will post (for the confirm popup).
  const sendSummary = useMemo(() => {
    const byC = new Map<string, { count: number; total: number; env: string | null; batch: string | null }>();
    for (const p of preview) {
      if (!p.ok) continue;
      const key = p.interfaceTarget ?? "—";
      const cur = byC.get(key) ?? { count: 0, total: 0, env: p.environment, batch: p.journalBatchName };
      cur.count += 1;
      cur.total += p.lines.reduce((s, l) => s + (l.debitAmount ?? 0), 0);
      byC.set(key, cur);
    }
    return Array.from(byC.entries()).map(([company, v]) => ({ company, ...v }));
  }, [preview]);
  const grandTotal = useMemo(() => sendSummary.reduce((s, x) => s + x.total, 0), [sendSummary]);

  // Fetch preview for the given ids — used by both "ดู Preview" and send buttons.
  const fetchPreviewForIds = useCallback(async (ids: number[]): Promise<PreviewItem[]> => {
    if (ids.length === 0) return [];
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/request/advance/erp-queue/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
      });
      const j = (await res.json()) as { ok: boolean; data?: PreviewItem[] };
      const data = j.ok && j.data ? j.data : [];
      setPreview(data);
      return data;
    } catch { setPreview([]); return []; } finally { setPreviewLoading(false); }
  }, []);

  async function handleShowPreview() {
    if (selectedIds.length === 0) return;
    await fetchPreviewForIds(selectedIds);
    setPreviewModalOpen(true);
  }

  async function handleSendSelected() {
    if (selectedIds.length === 0) return toast.error("เลือกรายการก่อน");
    const data = await fetchPreviewForIds(selectedIds);
    const ready = data.filter((p) => p.ok).map((p) => p.id);
    if (ready.length === 0) { toast.error("ไม่มีรายการที่พร้อมส่ง (config ยังไม่ครบ)"); return; }
    setFrozenIds(ready);
    setConfirmOpen(true);
  }

  async function changePaymentDate(id: number, paymentDate: string) {
    try {
      const res = await fetch("/api/request/advance/erp-queue/payment-date", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, paymentDate }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "แก้วันจ่ายไม่สำเร็จ"); return; }
      toast.success("อัปเดตวันจ่ายแล้ว");
      load();
    } catch {
      toast.error("แก้วันจ่ายไม่สำเร็จ");
    }
  }

  async function doPullback() {
    if (pullbackId == null) return;
    setPullbackBusy(true);
    try {
      const res = await fetch("/api/request/advance/erp-queue/pullback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pullbackId }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "ดึงกลับไม่สำเร็จ"); return; }
      toast.success(`ดึงกลับแล้ว — ย้ายไปแท็บ "รอส่ง"`);
      setPullbackId(null);
      load();
      setTab("pending");
    } finally {
      setPullbackBusy(false);
    }
  }

  async function doSend() {
    setBusy(true);
    try {
      const res = await fetch("/api/request/advance/erp-queue/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: frozenIds }),
      });
      const j = (await res.json()) as { ok: boolean; drift?: boolean; okCount?: number; failCount?: number; error?: string };
      if (res.status === 409 || j.drift) {
        toast.error(j.error ?? "คิวเปลี่ยนไปแล้ว — โหลดหน้าใหม่");
        setConfirmOpen(false);
        load();
        return;
      }
      if (j.error && !j.okCount) throw new Error(j.error);
      toast.success(`ส่งสำเร็จ ${j.okCount ?? 0} รายการ${j.failCount ? ` · ไม่สำเร็จ ${j.failCount}` : ""}`);
      setConfirmOpen(false);
      setSelected(new Set());
      load();
      setTab("sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ส่ง Interface ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const res = await fetch("/api/request/advance/erp-queue/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: sentFiltered.map((r) => r.id) }),
      });
      if (!res.ok) throw new Error("export ไม่สำเร็จ");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `advance-erp-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "export ไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>;
  }

  const STATUS_OPTS: { value: StatusFilter; label: string }[] = [
    { value: "ALL", label: "ทุกสถานะ" },
    { value: "Sent", label: "ส่งแล้ว" },
    { value: "Failed", label: "ล้มเหลว" },
    { value: "Pending", label: "กำลังส่ง" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <AdvanceCompanyBar value={company} onChange={setCompany} counts={counts} />

      {/* tabs */}
      <div className="flex items-center gap-1" style={{ borderBottom: "1px solid var(--border-card)" }}>
        {([["pending", `รอส่ง (${sendable.length})`], ["sent", `ส่งแล้ว (${sentAll.length})`]] as const).map(([t, label]) => {
          const active = tab === t;
          return (
            <button key={t} type="button" onClick={() => setTab(t)}
              className="px-4 py-2 text-[13px] font-semibold cursor-pointer border-none bg-transparent rounded-t-lg"
              style={{
                color: active ? "var(--nav-active-text)" : "var(--text-muted)",
                borderBottom: active ? "2px solid var(--nav-active-text)" : "2px solid transparent",
                marginBottom: "-1px",
              }}>
              {label}
            </button>
          );
        })}
      </div>

      {tab === "pending" ? (
        sendable.length === 0 ? (
          <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
            ไม่มีรายการรอส่ง — ส่งครบแล้ว 🎉
          </p>
        ) : (
          <>
            {/* send bar */}
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
              <FileText size={16} style={{ color: "var(--nav-active-text)" }} />
              <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                รอส่งเข้า ERP · {sendable.length} รายการ
              </span>
              {selectedIds.length > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "color-mix(in srgb, var(--nav-active-text) 10%, transparent)", color: "var(--nav-active-text)" }}>
                  เลือก {selectedIds.length}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button variant="secondary" size="sm"
                  icon={previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                  onClick={handleShowPreview} disabled={selectedIds.length === 0 || previewLoading || busy}>
                  ดู Preview ({selectedIds.length})
                </Button>
                <Button variant="primary" icon={<Upload size={15} />}
                  onClick={handleSendSelected} loading={previewLoading || busy}
                  disabled={selectedIds.length === 0 || previewLoading || busy}>
                  ส่งที่เลือก ({selectedIds.length})
                </Button>
              </div>
            </div>

            {/* per-row payment-date pickers (re-target the payment cycle before sending) */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr style={{ background: "var(--bg-card-alt)" }}>
                    <th className="px-3 py-2.5 w-8"
                      style={{ borderBottom: "1px solid var(--border-card)" }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        disabled={selectableIds.length === 0} className="cursor-pointer" />
                    </th>
                    {["เลขที่", "Company", "ผู้รับเงิน", "จำนวน", "Vendor", "วันจ่าย"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left font-bold whitespace-nowrap"
                        style={{ color: "var(--text-faint)", borderBottom: "1px solid var(--border-card)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sendable.map((row) => (
                    <tr key={row.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                      <td className="px-3 py-2.5 w-8">
                        <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)}
                          className="cursor-pointer" />
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <button type="button" onClick={() => setPanelId(row.id)} className="cursor-pointer font-bold text-left bg-transparent border-none p-0"
                          style={{ color: "var(--nav-active-text)" }}>{row.requestNo ?? `#${row.id}`}</button>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.interfaceTarget}</td>
                      <td className="px-2.5 py-2" style={{ color: "var(--text-primary)" }}>{row.payeeName ?? "—"}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-right tabular-nums font-semibold" style={{ color: "var(--text-secondary)" }}>{fmt(row.baseAmount ?? 0)}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        {/* Read-only: the Vendor is chosen/confirmed at the ACC_OFFICER
                            approval step (preview drawer), not here. */}
                        <span className="text-[12px] inline-block min-w-[260px]" style={{ color: "var(--text-secondary)" }}>
                          {row.matchedVendorName
                            ? `${row.matchedVendorName}${row.matchedVendorNo ? ` (${row.matchedVendorNo})` : ""}`
                            : row.matchedVendorNo ?? "—"}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        {paymentDateOpts.length > 0 ? (
                          <PaymentDatePicker
                            value={row.paymentDate ?? ""}
                            onChange={(d) => changePaymentDate(row.id, d)}
                            allowedDates={paymentDateOpts}
                          />
                        ) : (
                          <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{row.paymentDate ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        /* ── ส่งแล้ว tab ── */
        <>
          {/* filters */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา เลขที่ / ผู้รับเงิน"
                className="text-[12px] rounded-lg pl-7 pr-3 py-2 outline-none w-[220px]"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-input)", color: "var(--text-primary)" }} />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="text-[12px] rounded-lg px-2.5 py-2 outline-none cursor-pointer"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-input)", color: "var(--text-primary)" }}>
              {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {sentMonthOptions.length > 0 && (
              <FilterMonthPicker
                label="เดือนที่ส่ง"
                value={sentMonth}
                onChange={setSentMonth}
                availableMonths={sentMonthOptions}
                latestMonth={sentMonthOptions[0]}
              />
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{sentFiltered.length} รายการ</span>
              <Button variant="secondary" icon={<Download size={14} />} onClick={exportExcel}
                loading={exporting} disabled={sentFiltered.length === 0}>Export Excel</Button>
            </div>
          </div>

          {sentFiltered.length === 0 ? (
            <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>ไม่มีรายการตามเงื่อนไข</p>
          ) : (
            <div className="rounded-xl overflow-x-auto" style={{ border: "1px solid var(--border-card)" }}>
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr style={{ background: "var(--bg-card-alt)" }}>
                    {["เลขที่", "Company", "ผู้รับเงิน", "วันจ่าย", "จำนวน", "External Doc.", "Doc No. (ERP)", "วันที่ส่ง", "สถานะ", "การจัดการ"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left font-bold whitespace-nowrap"
                        style={{ color: "var(--text-faint)", borderBottom: "1px solid var(--border-card)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sentFiltered.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        <button type="button" onClick={() => setPanelId(r.id)} className="cursor-pointer font-bold text-left bg-transparent border-none p-0"
                          style={{ color: "var(--nav-active-text)" }}>{r.requestNo ?? `#${r.id}`}</button>
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{r.interfaceTarget}</td>
                      <td className="px-2.5 py-2" style={{ color: "var(--text-primary)" }}>{r.payeeName ?? "—"}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{r.paymentDate ?? "—"}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap text-right tabular-nums font-semibold" style={{ color: "var(--text-secondary)" }}>{fmt(r.baseAmount ?? 0)}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap font-mono" style={{ color: "var(--text-muted)" }}>{r.requestNo ?? "—"}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap font-mono font-semibold" style={{ color: r.erpDocumentNo ? "var(--text-secondary)" : "var(--text-faint)" }}>{r.erpDocumentNo ?? "—"}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{fmtDateTime(r.erpInterfaceSentAt)}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap"><SentBadge status={r.erpInterfaceStatus} error={r.erpInterfaceError} /></td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        {r.erpInterfaceStatus === "Sent" && (
                          <button type="button" onClick={() => setPullbackId(r.id)}
                            className="text-[12px] font-semibold px-2 py-1 rounded-lg cursor-pointer border-none"
                            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                            title="ดึงกลับเข้าคิวเพื่อยิงใหม่">
                            ดึงกลับเพื่อยิงใหม่
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Preview modal */}
      {previewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewModalOpen(false); }}>
          <div className="w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border-card)" }}>
              <span className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>
                Preview — Journal Lines ({selectedIds.length} รายการ)
              </span>
              <button type="button" onClick={() => setPreviewModalOpen(false)}
                className="text-[13px] px-3 py-1.5 rounded-lg cursor-pointer border-none"
                style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}>ปิด</button>
            </div>
            <div className="p-5 max-h-[72vh] overflow-y-auto">
              <AdvanceJournalPreview items={preview} loading={previewLoading} />
            </div>
          </div>
        </div>
      )}

      <AdvanceDetailPanel requestId={panelId} onClose={() => setPanelId(null)} />

      {/* confirm send popup */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => { if (!busy) setConfirmOpen(o); }}
        title="ยืนยันส่งเข้า Business Central"
        contentClassName="max-w-[440px]"
      >
        <div className="flex flex-col gap-3 p-1">
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            จะสร้าง Gen. Journal เข้า BC — {frozenIds.length} รายการ
          </p>

          <div className="flex flex-col gap-2 rounded-xl p-3"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
            {sendSummary.map((s) => {
              const prod = s.env === "Production";
              return (
                <div key={s.company} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2 text-[12px]">
                    <img src={`/brandlogo/${s.company.toLowerCase()}-200.png`} alt="" className="h-5 w-auto object-contain shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="font-bold" style={{ color: "var(--text-heading)" }}>{s.company}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                      style={prod
                        ? { background: "#dc262618", color: "#dc2626", border: "1px solid #dc262640" }
                        : { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: prod ? "#dc2626" : "var(--text-info-yellow)" }} />
                      {prod ? "Production" : "Sandbox"}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>· {s.count} ใบ</span>
                    <span className="ml-auto font-bold tabular-nums" style={{ color: "var(--text-heading)" }}>{fmt(s.total)} ฿</span>
                  </div>
                  <p className="text-[10px] m-0 pl-7" style={{ color: "var(--text-muted)" }}>
                    Journal Batch: <span className="font-mono font-semibold" style={{ color: "var(--text-secondary)" }}>{s.batch ?? "—"}</span>
                  </p>
                </div>
              );
            })}
            <div className="flex items-center justify-between text-[12px] pt-1.5 mt-0.5"
              style={{ borderTop: "1px solid var(--border-light)" }}>
              <span className="font-bold" style={{ color: "var(--text-heading)" }}>รวม</span>
              <span className="font-bold tabular-nums" style={{ color: "var(--text-heading)" }}>{fmt(grandTotal)} ฿</span>
            </div>
          </div>

          {/* destination notice */}
          {sendSummary.some((s) => s.env === "Production") ? (
            <p className="text-[12px] font-semibold px-3 py-2 rounded-lg"
              style={{ background: "#dc262614", color: "#dc2626", border: "1px solid #dc262633" }}>
              🔴 สร้างเข้า <b>Production (ระบบจริง)</b> — ตรวจสอบให้แน่ใจก่อนยืนยัน
            </p>
          ) : (
            <p className="text-[12px] px-3 py-2 rounded-lg"
              style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
              🟡 สร้างเข้า <b>Sandbox (UAT — ทดสอบ)</b> ไม่กระทบระบบจริง
            </p>
          )}

          {notReady > 0 && (
            <p className="text-[11px]" style={{ color: "var(--text-info-yellow)" }}>
              ⚠️ ข้าม {notReady} ใบที่ config ไม่ครบ (ส่งเฉพาะที่พร้อม)
            </p>
          )}

          <div className="flex items-center justify-end gap-2 mt-1">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>ยกเลิก</Button>
            <Button variant="primary" icon={<Upload size={15} />} onClick={doSend} loading={busy}>ยืนยันส่ง</Button>
          </div>
        </div>
      </Dialog>

      {/* pull-back confirm popup */}
      <Dialog
        open={pullbackId != null}
        onOpenChange={(o) => { if (!pullbackBusy && !o) setPullbackId(null); }}
        title="ดึงกลับเพื่อยิงใหม่?"
        description={`ใบเดิม (PV) จะถูกทำเครื่องหมายเป็น Resent และรายการจะกลับไปที่คิว "รอส่ง" เพื่อแก้วันจ่าย/ข้อมูลแล้วยิงใหม่ — บัญชีต้องไม่ post ใบ PV เดิมใน BC`}
        contentClassName="max-w-md"
      >
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => setPullbackId(null)} disabled={pullbackBusy}>ยกเลิก</Button>
          <Button variant="primary" onClick={doPullback} loading={pullbackBusy}>ยืนยันดึงกลับ</Button>
        </div>
      </Dialog>
    </div>
  );
}
