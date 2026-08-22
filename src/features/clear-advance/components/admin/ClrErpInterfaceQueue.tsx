"use client";

/**
 * AP-3 Interface ERP queue — lists all Approved clearings, allows preview of
 * the BC journal and batch-send to ERP. Mirrors the visual style of
 * ClrControlReport (CSS-var tokens, border-card table shell, sticky header).
 */

import React, { useState, useCallback } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, FileX, Eye, SendHorizonal, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ClrErpQueueRow } from "@/lib/clr/clear-advance-erp-queue-service";
import type { ClrPreviewItem } from "@/lib/clr/clear-advance-erp-send";
import { fmtMoney } from "@/features/clear-advance/components/admin/shared";

/* ─────────────────────── helpers ─────────────────────── */

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json()) as Promise<{ ok: boolean; data?: ClrErpQueueRow[]; error?: string }>;

function isSent(row: ClrErpQueueRow): boolean {
  return row.erpStatus === "Sent";
}
function isPending(row: ClrErpQueueRow): boolean {
  return row.erpStatus === "Pending";
}
function isSelectable(row: ClrErpQueueRow): boolean {
  return !isSent(row) && !isPending(row);
}

function EnvBadge({ env }: { env: string | null }) {
  if (!env) return null;
  const isSandbox = env === "Sandbox";
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-1"
      style={
        isSandbox
          ? {
              background: "color-mix(in srgb, var(--color-warning) 16%, transparent)",
              color: "var(--color-warning)",
              border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
            }
          : {
              background: "color-mix(in srgb, var(--status-bad-text) 14%, transparent)",
              color: "var(--status-bad-text)",
              border: "1px solid color-mix(in srgb, var(--status-bad-text) 30%, transparent)",
            }
      }
    >
      {isSandbox ? "UAT" : "PROD"}
    </span>
  );
}

function ErpStatusCell({ row }: { row: ClrErpQueueRow }) {
  const { erpStatus, erpEnvironment } = row;
  if (!erpStatus) {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}
      >
        ยังไม่ส่ง
      </span>
    );
  }
  if (erpStatus === "Sent") {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span
          className="text-[11px] px-2 py-0.5 rounded-full font-medium"
          style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)" }}
        >
          ส่งแล้ว
        </span>
        <EnvBadge env={erpEnvironment} />
      </div>
    );
  }
  if (erpStatus === "Pending") {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{
          background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
          color: "var(--color-warning)",
        }}
      >
        กำลังส่ง...
      </span>
    );
  }
  if (erpStatus === "Failed") {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: "var(--bg-info-red)", color: "var(--status-bad-text)" }}
      >
        ล้มเหลว
      </span>
    );
  }
  return (
    <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
      {erpStatus}
    </span>
  );
}

/* ─────────────────────── preview modal ─────────────────────── */

interface PreviewModalProps {
  items: ClrPreviewItem[];
  onClose: () => void;
}

function ClrErpPreviewModal({ items, onClose }: PreviewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl overflow-hidden flex flex-col max-h-[90vh] w-full max-w-4xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}
      >
        {/* modal header */}
        <div
          className="flex items-center justify-between px-5 py-3.5 shrink-0"
          style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-card)" }}
        >
          <span className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
            Preview BC Journal ({items.length} รายการ)
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        {/* modal body */}
        <div className="overflow-y-auto p-4 flex flex-col gap-4">
          {items.map((item) => {
            const totalDebit = item.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
            const totalCredit = item.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
            const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

            return (
              <div
                key={item.id}
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--border-card)" }}
              >
                {/* item header */}
                <div
                  className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                  style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-light)" }}
                >
                  <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                    {item.requestNo ?? `#${item.id}`}
                  </span>
                  {item.interfaceTarget && (
                    <span
                      className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
                    >
                      {item.interfaceTarget}
                    </span>
                  )}
                  {item.journalBatchName && (
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Batch: {item.journalBatchName}
                    </span>
                  )}
                  {item.environment && <EnvBadge env={item.environment} />}
                </div>

                {/* error */}
                {!item.ok && (
                  <div
                    className="px-3 py-2.5 text-[12px]"
                    style={{ color: "var(--status-bad-text)", background: "var(--bg-info-red)" }}
                  >
                    {item.error ?? "เกิดข้อผิดพลาด"}
                  </div>
                )}

                {/* journal lines */}
                {item.ok && item.lines.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] min-w-[700px]" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-card-alt)" }}>
                          {["Account Type", "Account No.", "Description", "Branch", "Dept", "Debit", "Credit"].map((h) => (
                            <th
                              key={h}
                              className={`px-2.5 py-1.5 font-semibold whitespace-nowrap ${h === "Debit" || h === "Credit" ? "text-right" : "text-left"}`}
                              style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border-light)" }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {item.lines.map((line, idx) => (
                          <tr
                            key={idx}
                            style={{ borderBottom: "1px solid var(--border-light)" }}
                          >
                            <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{line.accountType}</td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap font-mono" style={{ color: "var(--text-primary)" }}>{line.accountNo}</td>
                            <td className="px-2.5 py-1.5" style={{ color: "var(--text-primary)", maxWidth: 200 }}>{line.description}</td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{line.branchCode || "—"}</td>
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
                            {balanced ? (
                              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)" }}>
                                Dr = Cr ✓
                              </span>
                            ) : (
                              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--bg-info-red)", color: "var(--status-bad-text)" }}>
                                Dr ≠ Cr !
                              </span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums font-bold whitespace-nowrap" style={{ color: "var(--text-heading)" }}>
                            {fmtMoney(totalDebit)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums font-bold whitespace-nowrap" style={{ color: "var(--text-heading)" }}>
                            {fmtMoney(totalCredit)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
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

const COLS = [
  { label: "", align: "left" as const },          // checkbox
  { label: "เลขที่", align: "left" as const },
  { label: "แบรนด์", align: "left" as const },
  { label: "ผู้ยื่น", align: "left" as const },
  { label: "Advance", align: "left" as const },
  { label: "ใช้จริง", align: "right" as const },
  { label: "คืน/จ่ายเพิ่ม", align: "right" as const },
  { label: "สถานะ ERP", align: "left" as const },
  { label: "Doc No", align: "left" as const },
];

export function ClrErpInterfaceQueue() {
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data?: ClrErpQueueRow[]; error?: string }>(
    "/api/request/clear-advance/erp/queue",
    fetcher,
    { refreshInterval: 30_000 },
  );

  const rows: ClrErpQueueRow[] = data?.data ?? [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewItems, setPreviewItems] = useState<ClrPreviewItem[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  const selectableIds = rows.filter(isSelectable).map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleRow = useCallback((id: number, selectable: boolean) => {
    if (!selectable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(selectableIds);
    });
  }, [allSelected, selectableIds]);

  const selectedIds = Array.from(selected);

  const handlePreview = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setPreviewing(true);
    try {
      const res = await fetch(`/api/request/clear-advance/erp/preview?ids=${selectedIds.join(",")}`);
      const json = (await res.json()) as { ok: boolean; data?: ClrPreviewItem[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "preview ล้มเหลว");
      setPreviewItems(json.data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setPreviewing(false);
    }
  }, [selectedIds]);

  const handleSend = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(`ยืนยันส่งเข้า ERP จำนวน ${selectedIds.length} รายการ?`);
    if (!confirmed) return;
    setSending(true);
    try {
      const res = await fetch("/api/request/clear-advance/erp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { id: number; ok: boolean; error?: string; documentNo?: string | null }[];
        error?: string;
      };
      if (!json.ok && !json.data) {
        toast.error(json.error ?? "ส่งเข้า ERP ไม่สำเร็จ");
        return;
      }
      for (const item of json.data ?? []) {
        if (item.ok) {
          toast.success(`ส่งสำเร็จ #${item.id}${item.documentNo ? ` · Doc: ${item.documentNo}` : ""}`);
        } else {
          toast.error(`#${item.id}: ${item.error ?? "ล้มเหลว"}`);
        }
      }
      setSelected(new Set());
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setSending(false);
    }
  }, [selectedIds, mutate]);

  return (
    <>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-[13px] font-semibold" style={{ color: "var(--text-heading)" }}>
          คำขอเคลียร์เงินทดรองที่อนุมัติแล้ว ({rows.length} รายการ)
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="secondary"
            size="sm"
            icon={previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            onClick={handlePreview}
            disabled={selectedIds.length === 0 || previewing || sending}
          >
            ดู Preview ({selectedIds.length})
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={sending ? <Loader2 size={14} className="animate-spin" /> : <SendHorizonal size={14} />}
            onClick={handleSend}
            disabled={selectedIds.length === 0 || sending || previewing}
          >
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
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center" style={{ background: "var(--bg-card)" }}>
            <FileX size={32} style={{ color: "var(--text-muted)" }} />
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่พบคำขอที่อนุมัติแล้ว</p>
          </div>
        ) : (
          <div
            className="overflow-x-auto no-scrollbar max-h-[min(72vh,760px)] overflow-y-auto"
            style={{ background: "var(--bg-card)" }}
          >
            <table className="w-full text-[12px] border-collapse min-w-[900px]">
              <thead
                className="sticky top-0 z-10"
                style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}
              >
                <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                  <th className="px-3 py-2.5 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectableIds.length === 0}
                      className="cursor-pointer"
                    />
                  </th>
                  {COLS.slice(1).map((col) => (
                    <th
                      key={col.label}
                      className={`px-3 py-2.5 font-semibold whitespace-nowrap text-${col.align}`}
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const selectable = isSelectable(row);
                  const checked = selected.has(row.id);
                  const rowBg =
                    idx % 2 === 0
                      ? "transparent"
                      : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-page))";

                  return (
                    <tr
                      key={row.id}
                      className="transition-colors"
                      style={{ background: rowBg, borderBottom: "1px solid var(--border-light)", opacity: (!selectable && !isSent(row)) ? 0.7 : 1 }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "color-mix(in srgb, var(--nav-active-bg) 20%, var(--bg-card))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = rowBg;
                      }}
                    >
                      <td className="px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!selectable}
                          onChange={() => toggleRow(row.id, selectable)}
                          className={selectable ? "cursor-pointer" : "cursor-not-allowed opacity-40"}
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold" style={{ color: "var(--nav-active-text)" }}>
                          {row.requestNo ?? `#${row.id}`}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {row.brandCode ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                        {row.requesterFullName ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.advanceRequestNo ? (
                          <span
                            className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                          >
                            {row.advanceRequestNo}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-faint)" }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium" style={{ color: "var(--color-action)" }}>
                        {fmtMoney(row.actualTotal)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                        style={{
                          color:
                            (row.refundToCompany ?? 0) > 0
                              ? "var(--text-info-green)"
                              : (row.refundToCompany ?? 0) < 0
                              ? "var(--text-info-yellow)"
                              : "var(--text-faint)",
                        }}
                      >
                        {row.refundToCompany != null && row.refundToCompany !== 0
                          ? fmtMoney(row.refundToCompany)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <ErpStatusCell row={row} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {row.erpDocumentNo ?? <span style={{ color: "var(--text-faint)" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr
                  style={{
                    borderTop: "2px solid var(--border-card)",
                    background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-page))",
                    boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)",
                  }}
                >
                  <td colSpan={COLS.length} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
                    ทั้งหมด {rows.length} รายการ · ส่งแล้ว {rows.filter(isSent).length} · รอส่ง {rows.filter((r) => !isSent(r) && !isPending(r)).length}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* preview modal */}
      {previewItems && (
        <ClrErpPreviewModal items={previewItems} onClose={() => setPreviewItems(null)} />
      )}
    </>
  );
}
