"use client";

import React, { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, FileX, Eye, SendHorizonal, X, Search, Download, Building2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PaymentDatePicker } from "@/components/ui/PaymentDatePicker";
import { FilterMonthPicker } from "@/features/accounting/components/FilterMonthPicker";
import { sentMonthKey } from "@/features/accounting/components/ApprovalQueueFilters";
import type { ClrErpQueueRow } from "@/lib/clr/clear-advance-erp-queue-service";
import type { ClrPreviewItem } from "@/lib/clr/clear-advance-erp-send";
import { fmtMoney } from "@/features/clear-advance/components/admin/shared";

/* ─────────────────────── helpers ─────────────────────── */

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json()) as Promise<{ ok: boolean; data?: ClrErpQueueRow[]; error?: string }>;

type TabKey = "pending" | "sent";
type StatusFilter = "ALL" | "Sent" | "Pending" | "Failed";

function isSent(row: ClrErpQueueRow): boolean { return row.erpStatus === "Sent"; }
function isPending(row: ClrErpQueueRow): boolean { return row.erpStatus === "Pending"; }
function isSelectable(row: ClrErpQueueRow): boolean { return !isSent(row) && !isPending(row); }

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  // `th-TH` alone is the Buddhist calendar — this printed 04/09/**69**.
  return d.toLocaleString("th-TH-u-ca-gregory", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function EnvBadge({ env }: { env: string | null }) {
  if (!env) return null;
  const isSandbox = env === "Sandbox";
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-1"
      style={
        isSandbox
          ? { background: "color-mix(in srgb, var(--color-warning) 16%, transparent)", color: "var(--color-warning)", border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)" }
          : { background: "color-mix(in srgb, var(--status-bad-text) 14%, transparent)", color: "var(--status-bad-text)", border: "1px solid color-mix(in srgb, var(--status-bad-text) 30%, transparent)" }
      }
    >
      {isSandbox ? "UAT" : "PROD"}
    </span>
  );
}

function ErpStatusBadge({ row }: { row: ClrErpQueueRow }) {
  const { erpStatus, erpError } = row;
  if (!erpStatus) return (
    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
      style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}>ยังไม่ส่ง</span>
  );
  if (erpStatus === "Sent") return (
    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
      style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)" }}>ส่งแล้ว</span>
  );
  if (erpStatus === "Pending") return (
    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
      style={{ background: "color-mix(in srgb, var(--color-warning) 14%, transparent)", color: "var(--color-warning)" }}>
      กำลังส่ง...
    </span>
  );
  if (erpStatus === "Failed") return (
    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" title={erpError ?? undefined}
      style={{ background: "var(--bg-info-red)", color: "var(--status-bad-text)" }}>ล้มเหลว</span>
  );
  return <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{erpStatus}</span>;
}

/* ─────────────────────── preview modal ─────────────────────── */

function ClrErpPreviewModal({ items, onClose }: { items: ClrPreviewItem[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl overflow-hidden flex flex-col max-h-[90vh] w-full max-w-4xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 shrink-0"
          style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-card)" }}>
          <span className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
            Preview BC Journal ({items.length} รายการ)
          </span>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
            <X size={14} />
          </button>
        </div>
        <div className="overflow-y-auto p-4 flex flex-col gap-4">
          {items.map((item) => {
            const totalDebit = item.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
            const totalCredit = item.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
            return (
              <div key={item.id} className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                  style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-light)" }}>
                  <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{item.requestNo ?? `#${item.id}`}</span>
                  {item.interfaceTarget && (
                    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>{item.interfaceTarget}</span>
                  )}
                  {item.journalBatchName && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Batch: {item.journalBatchName}</span>}
                  {/* Which way the money actually moves, while it can still be
                      stopped. Read off the bank line's sign rather than the
                      Document Type: since 2026-09-08 that is always "Refund" by
                      decision, so it no longer tells the two apart — and a badge
                      reading "คืนบริษัท" over a clearing that pays the employee
                      would be worse than no badge at all. */}
                  {(() => {
                    const bank = item.lines?.find((l) => l.accountType === "Bank Account");
                    if (!bank) return null;
                    const backToCompany = (bank.debit ?? 0) > 0;
                    return (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: backToCompany ? "var(--status-ok-bg)" : "var(--bg-badge)",
                          color: backToCompany ? "var(--status-ok-text)" : "var(--text-muted)",
                        }}>
                        {backToCompany ? "คืนบริษัท" : "จ่ายพนักงานเพิ่ม"}
                      </span>
                    );
                  })()}
                  {item.environment && <EnvBadge env={item.environment} />}
                </div>
                {!item.ok && (
                  <div className="px-3 py-2.5 text-[12px]"
                    style={{ color: "var(--status-bad-text)", background: "var(--bg-info-red)" }}>
                    {item.error ?? "เกิดข้อผิดพลาด"}
                  </div>
                )}
                {item.ok && item.lines.length > 0 && (
                  <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] min-w-[700px]" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-card-alt)" }}>
                          {["Account Type", "Account No.", "Description", "Branch", "Dept", "Debit", "Credit"].map((h) => (
                            <th key={h} className={`px-2.5 py-1.5 font-semibold whitespace-nowrap ${h === "Debit" || h === "Credit" ? "text-right" : "text-left"}`}
                              style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border-light)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {item.lines.map((line, idx) => (
                          <tr key={idx} style={{ borderBottom: "1px solid var(--border-light)" }}>
                            <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{line.accountType}</td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap font-mono" style={{ color: "var(--text-primary)" }}>{line.accountNo}</td>
                            <td className="px-2.5 py-1.5" style={{ color: "var(--text-primary)", maxWidth: 200 }}>{line.description}</td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                              {line.branchCode || "—"}
                              {/* A prior-period line is the exception, so it reads as a
                                  mark on the branch rather than a column that would be
                                  empty on almost every row. */}
                              {line.adjCode && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded ml-1.5"
                                  style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)" }}
                                  title="ใบเสร็จลงเดือนก่อนเดือนที่โพสต์ — ปรับปรุงบัญชี (Z-ADJ)">
                                  {line.adjCode}
                                </span>
                              )}
                              {/* The BU the line will post to. It reads as part of the
                                  branch because that is what decides it — the Location
                                  the branch is bound to. */}
                              {line.buCode && (
                                <span className="text-[10px] ml-1.5" style={{ color: "var(--text-muted)" }}>
                                  · {line.buCode}
                                </span>
                              )}
                              {/* Shown, never enforced: BC may still take the line, and
                                  refusing on an untested assumption would block work
                                  that actually posts. */}
                              {line.branchBlocked && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded ml-1.5"
                                  style={{ background: "var(--bg-badge)", color: "var(--text-warning)" }}
                                  title="สาขานี้ถูก Block ใน BC — ส่งได้ แต่ BC อาจไม่รับบรรทัดนี้">
                                  BLOCKED
                                </span>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{line.departmentCode || "—"}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap" style={{ color: line.debit ? "var(--text-primary)" : "var(--text-faint)" }}>
                              {line.debit != null ? fmtMoney(line.debit) : "—"}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums whitespace-nowrap" style={{ color: line.credit ? "var(--text-primary)" : "var(--text-faint)" }}>
                              {line.credit != null ? fmtMoney(line.credit) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: "2px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
                          <td colSpan={5} className="px-2.5 py-1.5 text-[11px] font-bold" style={{ color: "var(--text-heading)" }}>
                            รวม ({item.lines.length} บรรทัด)
                          </td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums font-bold whitespace-nowrap" style={{ color: "var(--text-heading)" }}>{fmtMoney(totalDebit)}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums font-bold whitespace-nowrap" style={{ color: "var(--text-heading)" }}>{fmtMoney(totalCredit)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {/* An AP-3 journal never balances by design, so a Dr≠Cr warning here would
                      train reviewers to ignore the preview. Explain it instead of flagging it. */}
                  <p className="px-3 py-2 text-[10px] leading-snug" style={{ color: "var(--text-faint)" }}>
                    ยอด Debit/Credit ไม่เท่ากันเป็นเรื่องปกติ — WHT และบรรทัดล้างเวนเดอร์ส่งเป็น 0 ตามข้อกำหนด (บัญชีล้างเองใน ERP)
                  </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── main component ─────────────────────── */

export function ClrErpInterfaceQueue() {
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data?: ClrErpQueueRow[]; error?: string }>(
    "/api/request/clear-advance/erp/queue",
    fetcher,
    { refreshInterval: 30_000 },
  );

  const rows: ClrErpQueueRow[] = data?.data ?? [];

  // brand filter state
  const [brand, setBrand] = useState<string>("__ALL__");

  // unique brands derived from rows
  const brandCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const b = r.brandCode ?? "—";
      c[b] = (c[b] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const uniqueBrands = useMemo(() => Object.keys(brandCounts).sort(), [brandCounts]);

  // apply brand filter
  const filteredByBrand = useMemo(
    () => (brand === "__ALL__" ? rows : rows.filter((r) => r.brandCode === brand)),
    [rows, brand],
  );

  // sub-tab state
  const [tab, setTab] = useState<TabKey>("pending");

  // pending-tab state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewItems, setPreviewItems] = useState<ClrPreviewItem[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  /* The send confirmation, same shape AP-2 uses: what is about to be created is
     summarised per company before anyone commits to it, and the ids are frozen
     when the dialog opens so changing the selection behind it cannot change what
     gets sent. */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [frozenIds, setFrozenIds] = useState<number[]>([]);
  const [confirmItems, setConfirmItems] = useState<ClrPreviewItem[]>([]);

  // sent-tab filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sentMonth, setSentMonth] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  // Payment-date options for the per-row "รอส่ง" picker (loaded once, shared calendar).
  const [paymentDateOpts, setPaymentDateOpts] = useState<string[]>([]);
  React.useEffect(() => {
    fetch("/api/request/advance/payment-dates")
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: { dates?: string[] } }) => { if (j?.data?.dates) setPaymentDateOpts(j.data.dates); })
      .catch(() => {});
  }, []);

  const changePaymentDate = useCallback(async (id: number, paymentDate: string) => {
    try {
      const res = await fetch("/api/request/clear-advance/erp/payment-date", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, paymentDate }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "แก้วันจ่ายไม่สำเร็จ"); return; }
      toast.success("อัปเดตวันจ่ายแล้ว");
      await mutate();
    } catch {
      toast.error("แก้วันจ่ายไม่สำเร็จ");
    }
  }, [mutate]);

  // split rows (after brand filter)
  const sendableRows = useMemo(() => filteredByBrand.filter(isSelectable), [filteredByBrand]);
  const sentRows = useMemo(() => filteredByBrand.filter((r) => !isSelectable(r)), [filteredByBrand]);

  // sent-tab month options
  const sentMonthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of sentRows) {
      if (r.erpStatus !== "Sent") continue;
      const k = sentMonthKey(r.erpSentAt);
      if (k) set.add(k);
    }
    return Array.from(set).sort().reverse();
  }, [sentRows]);

  // auto-select latest month when options load
  React.useEffect(() => {
    if (sentMonthOptions.length === 0) { setSentMonth((p) => (p === "" ? p : "")); return; }
    setSentMonth((p) => (p && sentMonthOptions.includes(p) ? p : sentMonthOptions[0]));
  }, [sentMonthOptions]);

  // sent-tab filtered rows
  const sentFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sentRows.filter((r) => {
      if (statusFilter !== "ALL" && r.erpStatus !== statusFilter) return false;
      if (sentMonth && r.erpStatus === "Sent" && sentMonthKey(r.erpSentAt) !== sentMonth) return false;
      if (q && !`${r.requestNo ?? ""} ${r.requesterFullName ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sentRows, statusFilter, sentMonth, search]);

  // pending-tab checkbox logic
  const selectableIds = sendableRows.map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleRow = useCallback((id: number, selectable: boolean) => {
    if (!selectable) return;
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(() => allSelected ? new Set() : new Set(selectableIds));
  }, [allSelected, selectableIds]);

  const selectedIds = Array.from(selected);

  /** Preview for a given set of ids — shared by the Preview button and the send
   *  confirmation, which needs the same data to say what it is about to post. */
  const fetchPreviewForIds = useCallback(async (ids: number[]): Promise<ClrPreviewItem[]> => {
    const res = await fetch(`/api/request/clear-advance/erp/preview?ids=${ids.join(",")}`);
    const json = (await res.json()) as { ok: boolean; data?: ClrPreviewItem[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "preview ล้มเหลว");
    return json.data ?? [];
  }, []);

  const handlePreview = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setPreviewing(true);
    try {
      setPreviewItems(await fetchPreviewForIds(selectedIds));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setPreviewing(false);
    }
  }, [selectedIds, fetchPreviewForIds]);

  /** Open the confirmation. The preview runs first so the dialog can say which
   *  company and environment each clearing is bound for, and so a clearing whose
   *  config is incomplete is dropped before anything is sent rather than failing
   *  one line at a time in BC. */
  const openSendConfirm = useCallback(async () => {
    if (selectedIds.length === 0) return toast.error("เลือกรายการก่อน");
    setPreviewing(true);
    try {
      const data = await fetchPreviewForIds(selectedIds);
      const ready = data.filter((p) => p.ok);
      if (ready.length === 0) { toast.error("ไม่มีรายการที่พร้อมส่ง (ตั้งค่ายังไม่ครบ)"); return; }
      setConfirmItems(data);
      setFrozenIds(ready.map((p) => p.id));
      setConfirmOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setPreviewing(false);
    }
  }, [selectedIds, fetchPreviewForIds]);

  const handleSend = useCallback(async () => {
    if (frozenIds.length === 0) return;
    setSending(true);
    try {
      const res = await fetch("/api/request/clear-advance/erp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: frozenIds }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { id: number; ok: boolean; error?: string; documentNo?: string | null }[];
        error?: string;
      };
      if (!json.ok && !json.data) { toast.error(json.error ?? "ส่งเข้า ERP ไม่สำเร็จ"); return; }
      for (const item of json.data ?? []) {
        if (item.ok) toast.success(`ส่งสำเร็จ #${item.id}${item.documentNo ? ` · Doc: ${item.documentNo}` : ""}`);
        else toast.error(`#${item.id}: ${item.error ?? "ล้มเหลว"}`);
      }
      setConfirmOpen(false);
      setSelected(new Set());
      setTab("sent");
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setSending(false);
    }
  }, [frozenIds, mutate]);

  /** What the send will post, grouped by the BC company each clearing targets —
   *  the same summary AP-2's confirmation shows. */
  const sendSummary = useMemo(() => {
    const byCompany = new Map<string, { count: number; total: number; env: string | null; batch: string | null }>();
    for (const p of confirmItems) {
      if (!p.ok) continue;
      const key = p.interfaceTarget ?? "—";
      const cur = byCompany.get(key) ?? { count: 0, total: 0, env: p.environment, batch: p.journalBatchName };
      cur.count += 1;
      cur.total += p.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      byCompany.set(key, cur);
    }
    return Array.from(byCompany.entries()).map(([company, v]) => ({ company, ...v }));
  }, [confirmItems]);

  const grandTotal = useMemo(() => sendSummary.reduce((s, x) => s + x.total, 0), [sendSummary]);

  // Requests, not lines: what accounting decides about at this point is whether
  // to send a document, and one blocked branch usually marks several of its lines.
  const blockedCount = useMemo(
    () => confirmItems.filter((p) => p.ok && p.lines.some((l) => l.branchBlocked)).length,
    [confirmItems],
  );
  const notReady = confirmItems.length - frozenIds.length;

  async function exportExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      sentFiltered.forEach((r) => params.append("ids", String(r.id)));
      const res = await fetch(`/api/request/clear-advance/erp/queue/export?${params.toString()}`);
      if (!res.ok) throw new Error("export ไม่สำเร็จ");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clr-erp-sent-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "export ไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  const STATUS_OPTS: { value: StatusFilter; label: string }[] = [
    { value: "ALL", label: "ทุกสถานะ" },
    { value: "Sent", label: "ส่งแล้ว" },
    { value: "Failed", label: "ล้มเหลว" },
    { value: "Pending", label: "กำลังส่ง" },
  ];

  return (
    <>
      {/* brand filter bar */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Building2 size={15} style={{ color: "var(--text-muted)" }} />
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>แบรนด์:</span>
          <div className="flex gap-1 flex-wrap">
            {[{ id: "__ALL__", label: "ทั้งหมด", logo: null }, ...uniqueBrands.map((b) => ({ id: b, label: b, logo: `/brandlogo/${b.toLowerCase()}-200.png` }))].map((o) => {
              const active = brand === o.id;
              const count = o.id === "__ALL__" ? rows.length : brandCounts[o.id] ?? 0;
              return (
                <button key={o.id} type="button" onClick={() => setBrand(o.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg cursor-pointer border transition-colors"
                  style={{
                    background: active ? "var(--nav-active-bg)" : "transparent",
                    color: active ? "var(--nav-active-text)" : "var(--text-muted)",
                    borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                  }}>
                  {o.logo && (
                    <img src={o.logo} alt="" className="h-4 w-auto object-contain shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                  {o.label}
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      background: active ? "var(--nav-active-text)" : "var(--bg-card-alt)",
                      color: active ? "var(--nav-active-bg)" : "var(--text-faint)",
                    }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* sub-tabs */}
      <div className="flex items-center gap-1 mb-4" style={{ borderBottom: "1px solid var(--border-card)" }}>
        {([["pending", `รอส่ง (${sendableRows.length})`], ["sent", `ส่งแล้ว (${sentRows.length})`]] as const).map(([t, label]) => {
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

      {/* ── รอส่ง tab ── */}
      {tab === "pending" && (
        <>
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-heading)" }}>
              คำขอเคลียร์เงินทดรองที่อนุมัติแล้ว ({sendableRows.length} รายการ)
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="secondary" size="sm"
                icon={previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                onClick={handlePreview} disabled={selectedIds.length === 0 || previewing || sending}>
                ดู Preview ({selectedIds.length})
              </Button>
              <Button variant="primary" size="sm"
                icon={sending ? <Loader2 size={14} className="animate-spin" /> : <SendHorizonal size={14} />}
                onClick={openSendConfirm} disabled={selectedIds.length === 0 || sending || previewing}>
                ส่งเข้า ERP ({selectedIds.length})
              </Button>
            </div>
          </div>

          {/* table */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
            {isLoading ? (
              <div className="flex items-center justify-center py-16" style={{ background: "var(--bg-card)" }}>
                <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              </div>
            ) : sendableRows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center" style={{ background: "var(--bg-card)" }}>
                <FileX size={32} style={{ color: "var(--text-muted)" }} />
                <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่มีรายการรอส่ง — ส่งครบแล้ว 🎉</p>
              </div>
            ) : (
              <div className="overflow-x-auto no-scrollbar max-h-[min(72vh,760px)] overflow-y-auto" style={{ background: "var(--bg-card)" }}>
                <table className="w-full text-[12px] border-collapse min-w-[900px]">
                  <thead className="sticky top-0 z-10"
                    style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}>
                    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                      <th className="px-3 py-2.5 w-8">
                        <input type="checkbox" checked={allSelected} onChange={toggleAll}
                          disabled={selectableIds.length === 0} className="cursor-pointer" />
                      </th>
                      {["เลขที่", "แบรนด์", "ผู้ยื่น", "Advance", "ใช้จริง", "คืน/จ่ายเพิ่ม", "วันจ่าย", "สถานะ ERP", "Doc No"].map((h) => (
                        <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap text-left"
                          style={{ color: "var(--text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sendableRows.map((row, idx) => {
                      const selectable = isSelectable(row);
                      const checked = selected.has(row.id);
                      const rowBg = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-page))";
                      return (
                        <tr key={row.id} className="transition-colors"
                          style={{ background: rowBg, borderBottom: "1px solid var(--border-light)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--nav-active-bg) 20%, var(--bg-card))"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = rowBg; }}>
                          <td className="px-3 py-2 w-8">
                            <input type="checkbox" checked={checked} disabled={!selectable}
                              onChange={() => toggleRow(row.id, selectable)}
                              className={selectable ? "cursor-pointer" : "cursor-not-allowed opacity-40"} />
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="font-semibold" style={{ color: "var(--nav-active-text)" }}>{row.requestNo ?? `#${row.id}`}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.brandCode ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{row.requesterFullName ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.advanceRequestNo
                              ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>{row.advanceRequestNo}</span>
                              : <span style={{ color: "var(--text-faint)" }}>—</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium" style={{ color: "var(--color-action)" }}>
                            {fmtMoney(row.actualTotal)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                            style={{ color: (row.refundToCompany ?? 0) > 0 ? "var(--text-info-green)" : (row.refundToCompany ?? 0) < 0 ? "var(--text-info-yellow)" : "var(--text-faint)" }}>
                            {row.refundToCompany != null && row.refundToCompany !== 0 ? fmtMoney(row.refundToCompany) : "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
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
                          <td className="px-3 py-2 whitespace-nowrap"><ErpStatusBadge row={row} /></td>
                          <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                            {row.erpDocumentNo ?? <span style={{ color: "var(--text-faint)" }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-10">
                    <tr style={{ borderTop: "2px solid var(--border-card)", background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-page))", boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)" }}>
                      <td colSpan={10} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
                        รอส่ง {sendableRows.length} รายการ
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── ส่งแล้ว tab ── */}
      {tab === "sent" && (
        <>
          {/* filters */}
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา เลขที่ / ผู้ยื่น"
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
                loading={exporting} disabled={sentFiltered.length === 0}>
                Export Excel
              </Button>
            </div>
          </div>

          {sentFiltered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center rounded-xl"
              style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)" }}>
              <FileX size={32} style={{ color: "var(--text-muted)" }} />
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่มีรายการตามเงื่อนไข</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
              <div className="overflow-x-auto no-scrollbar max-h-[min(72vh,760px)] overflow-y-auto" style={{ background: "var(--bg-card)" }}>
                <table className="w-full text-[12px] border-collapse min-w-[1000px]">
                  <thead className="sticky top-0 z-10"
                    style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}>
                    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                      {["เลขที่", "แบรนด์", "ผู้ยื่น", "Advance", "ใช้จริง", "คืน/จ่ายเพิ่ม", "วันจ่าย", "Doc No (ERP)", "วันที่ส่ง", "สถานะ"].map((h) => (
                        <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap text-left"
                          style={{ color: "var(--text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sentFiltered.map((row, idx) => {
                      const rowBg = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-page))";
                      return (
                        <tr key={row.id} className="transition-colors"
                          style={{ background: rowBg, borderBottom: "1px solid var(--border-light)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--nav-active-bg) 20%, var(--bg-card))"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = rowBg; }}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="font-semibold" style={{ color: "var(--nav-active-text)" }}>{row.requestNo ?? `#${row.id}`}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.brandCode ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{row.requesterFullName ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.advanceRequestNo
                              ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>{row.advanceRequestNo}</span>
                              : <span style={{ color: "var(--text-faint)" }}>—</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium" style={{ color: "var(--color-action)" }}>
                            {fmtMoney(row.actualTotal)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                            style={{ color: (row.refundToCompany ?? 0) > 0 ? "var(--text-info-green)" : (row.refundToCompany ?? 0) < 0 ? "var(--text-info-yellow)" : "var(--text-faint)" }}>
                            {row.refundToCompany != null && row.refundToCompany !== 0 ? fmtMoney(row.refundToCompany) : "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                            {row.paymentDate ?? "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap font-mono font-semibold text-[11px]"
                            style={{ color: row.erpDocumentNo ? "var(--text-secondary)" : "var(--text-faint)" }}>
                            {row.erpDocumentNo ?? "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                            {fmtDateTime(row.erpSentAt)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap"><ErpStatusBadge row={row} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-10">
                    <tr style={{ borderTop: "2px solid var(--border-card)", background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-page))", boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)" }}>
                      <td colSpan={10} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
                        ทั้งหมด {sentFiltered.length} รายการ · ส่งแล้ว {sentFiltered.filter(isSent).length} · ล้มเหลว {sentFiltered.filter((r) => r.erpStatus === "Failed").length}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* preview modal */}
      {previewItems && (
        <ClrErpPreviewModal items={previewItems} onClose={() => setPreviewItems(null)} />
      )}

      {/* Send confirmation — the same popup AP-2 uses, in place of the browser's
          own confirm(), which could say nothing about where the journal was
          bound for. Sending into Production reads differently from Sandbox and
          the dialog has to make that visible while it can still be stopped. */}
      {confirmOpen && (
        <Dialog
          open={confirmOpen}
          onOpenChange={(o) => { if (!sending) setConfirmOpen(o); }}
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
                      <Building2 size={14} style={{ color: "var(--text-muted)" }} />
                      <span className="font-bold" style={{ color: "var(--text-heading)" }}>{s.company}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                        style={prod
                          ? { background: "#dc262618", color: "#dc2626", border: "1px solid #dc262640" }
                          : { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: prod ? "#dc2626" : "var(--text-info-yellow)" }} />
                        {prod ? "Production" : "Sandbox"}
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>· {s.count} ใบ</span>
                      <span className="ml-auto font-bold tabular-nums" style={{ color: "var(--text-heading)" }}>{fmtMoney(s.total)} ฿</span>
                    </div>
                    <p className="text-[10px] m-0 pl-6" style={{ color: "var(--text-muted)" }}>
                      Journal Batch: <span className="font-mono font-semibold" style={{ color: "var(--text-secondary)" }}>{s.batch ?? "—"}</span>
                    </p>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-[12px] pt-1.5 mt-0.5"
                style={{ borderTop: "1px solid var(--border-light)" }}>
                <span className="font-bold" style={{ color: "var(--text-heading)" }}>รวม</span>
                <span className="font-bold tabular-nums" style={{ color: "var(--text-heading)" }}>{fmtMoney(grandTotal)} ฿</span>
              </div>
            </div>

            {sendSummary.some((s) => s.env === "Production") ? (
              <p className="text-[12px] font-semibold px-3 py-2 rounded-lg m-0"
                style={{ background: "#dc262614", color: "#dc2626", border: "1px solid #dc262633" }}>
                🔴 สร้างเข้า <b>Production (ระบบจริง)</b> — ตรวจสอบให้แน่ใจก่อนยืนยัน
              </p>
            ) : (
              <p className="text-[12px] px-3 py-2 rounded-lg m-0"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                🟡 สร้างเข้า <b>Sandbox (UAT — ทดสอบ)</b> ไม่กระทบระบบจริง
              </p>
            )}

            {blockedCount > 0 && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-warning)" }}>
                ⚠️ {blockedCount} ใบมีสาขาที่ถูก Block ใน BC — ส่งได้ แต่ BC อาจไม่รับบรรทัดนั้น
              </p>
            )}

            {notReady > 0 && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-info-yellow)" }}>
                ⚠️ ข้าม {notReady} ใบที่ตั้งค่าไม่ครบ (ส่งเฉพาะที่พร้อม)
              </p>
            )}

            <div className="flex items-center justify-end gap-2 mt-1">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={sending}>ยกเลิก</Button>
              <Button variant="primary" icon={<SendHorizonal size={15} />} onClick={handleSend} loading={sending}>ยืนยันส่ง</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
