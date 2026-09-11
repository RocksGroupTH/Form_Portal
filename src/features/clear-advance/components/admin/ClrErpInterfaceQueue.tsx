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
import type { ClrPreviewItem, ClrPreviewLine } from "@/lib/clr/clear-advance-erp-send";
import { effectiveSelection } from "@/lib/clr/erp-queue-selection";
import { fmtMoney } from "@/features/clear-advance/components/admin/shared";

/* ─────────────────────── helpers ─────────────────────── */

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json()) as Promise<{ ok: boolean; data?: ClrErpQueueRow[]; error?: string }>;

type TabKey = "pending" | "sent" | "failed" | "cancelled";
type StatusFilter = "ALL" | "Sent" | "Pending" | "Failed";

function isSent(row: ClrErpQueueRow): boolean { return row.erpStatus === "Sent"; }
function isPending(row: ClrErpQueueRow): boolean { return row.erpStatus === "Pending"; }
/**
 * Whether a row may be ticked and sent.
 *
 * A failed row is not one. It used to be — "not Sent, not Pending" — so a
 * retry was a tick away, and a partial failure had already left lines in BC that
 * the retry would insert a second time. It now has to be pulled back
 * deliberately, which is where that gets said.
 */
function isSelectable(row: ClrErpQueueRow): boolean {
  return !isCancelled(row) && !isSent(row) && !isPending(row) && row.erpStatus !== "Failed";
}

/** Cancelled after approval — in the queue only so the ยกเลิก tab can show it. */
function isCancelled(row: ClrErpQueueRow): boolean { return row.status === "Cancelled"; }


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

/**
 * The answer as something a person can read.
 *
 * The codeunit replies with JSON wrapped in an OData `value` string, so the
 * useful part arrives escaped inside a string inside an object. Unwrapped and
 * indented here; anything that does not parse is shown exactly as it came,
 * because a response we cannot read is still evidence.
 */
function prettyJson(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  try {
    const outer = JSON.parse(raw) as unknown;
    const inner =
      outer && typeof outer === "object" && "value" in outer
        ? (outer as { value?: unknown }).value
        : outer;
    if (typeof inner === "string") {
      try {
        return JSON.stringify(JSON.parse(inner), null, 2);
      } catch {
        return inner;
      }
    }
    return JSON.stringify(inner, null, 2);
  } catch {
    return raw;
  }
}

function ErpStatusBadge({ row, onShow }: { row: ClrErpQueueRow; onShow?: (r: ClrErpQueueRow) => void }) {
  const { erpStatus, erpError } = row;
  const readable = !!(erpError || row.erpResponse);
  if (!erpStatus) return (
    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
      style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}>ยังไม่ส่ง</span>
  );
  if (erpStatus === "Sent") return readable ? (
    <button
      type="button"
      onClick={() => onShow?.(row)}
      className="text-[11px] px-2 py-0.5 rounded-full font-medium cursor-pointer"
      style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "none" }}
    >
      ส่งแล้ว
    </button>
  ) : (
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
    // A red pill with the reason hidden in a tooltip meant the reason may as
    // well not have been kept: BC's answer is several lines long, and a title
    // attribute shows it to nobody who did not already know to hover.
    <button
      type="button"
      onClick={() => onShow?.(row)}
      title={erpError ?? undefined}
      className="text-[11px] px-2 py-0.5 rounded-full font-medium cursor-pointer"
      style={{ background: "var(--bg-info-red)", color: "var(--status-bad-text)", border: "none" }}
    >
      ล้มเหลว · ดูสาเหตุ
    </button>
  );
  return <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{erpStatus}</span>;
}

/* ─────────────────────── preview modal ─────────────────────── */

/**
 * The preview's columns are Business Central's, named as BC names them.
 *
 * The point of a preview is to be compared with what BC will hold, and the old
 * seven — Account Type, Account No., Description, Branch, Dept, Debit, Credit —
 * could not answer the question the VAT work made worth asking, because the
 * whole tax block was sent and never shown. These are the `Gen. Journal Line`
 * fields the payload writes, in the order BC lists them; the last seven come
 * from tableextension 80105 (`NWTH CustomizationRevolic`), whose captions differ
 * from the interface sheet's wording and are given here as BC shows them.
 */
interface BcCol {
  key: string;
  label: string;
  numeric?: boolean;
  mono?: boolean;
  dim?: boolean;
  render: (l: ClrPreviewLine) => React.ReactNode;
}

const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

const BC_COLUMNS: BcCol[] = [
  { key: "postingDate", label: "Posting Date", dim: true, render: (l) => dash(l.postingDate) },
  { key: "documentType", label: "Document Type", render: (l) => dash(l.documentType) },
  { key: "accountType", label: "Account Type", dim: true, render: (l) => dash(l.accountType) },
  { key: "accountNo", label: "Account No.", mono: true, render: (l) => dash(l.accountNo) },
  { key: "description", label: "Description", render: (l) => dash(l.description) },
  { key: "debit", label: "Debit Amount", numeric: true, render: (l) => (l.debit != null ? fmtMoney(l.debit) : "—") },
  { key: "credit", label: "Credit Amount", numeric: true, render: (l) => (l.credit != null ? fmtMoney(l.credit) : "—") },
  { key: "balAccountType", label: "Bal. Account Type", dim: true, render: (l) => dash(l.balAccountType) },
  { key: "paymentMethodCode", label: "Payment Method Code", dim: true, render: (l) => dash(l.paymentMethodCode) },
  { key: "employeeCode", label: "External Document No.", mono: true, dim: true, render: (l) => dash(l.employeeCode) },
  {
    key: "branchCode",
    label: "BRANCH",
    render: (l) => (
      <span className="inline-flex items-center gap-1.5">
        {dash(l.branchCode)}
        {/* Shown, never enforced: BC may still take the line. */}
        {l.branchBlocked && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: "var(--bg-badge)", color: "var(--text-warning)" }}
            title="สาขานี้ถูก Block ใน BC — ส่งได้ แต่ BC อาจไม่รับบรรทัดนี้">
            BLOCKED
          </span>
        )}
      </span>
    ),
  },
  { key: "departmentCode", label: "DEPT", dim: true, render: (l) => dash(l.departmentCode) },
  { key: "buCode", label: "BU", dim: true, render: (l) => dash(l.buCode) },
  {
    key: "adjCode",
    label: "Z-ADJ",
    render: (l) =>
      l.adjCode ? (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)" }}
          title="ใบเสร็จลงเดือนก่อนเดือนที่โพสต์ — ปรับปรุงบัญชี">
          {l.adjCode}
        </span>
      ) : "—",
  },
  { key: "genPostingType", label: "Gen. Posting Type", dim: true, render: (l) => dash(l.genPostingType) },
  { key: "vatBusPostingGroup", label: "VAT Bus. Posting Group", dim: true, render: (l) => dash(l.vatBusPostingGroup) },
  { key: "vatProdPostingGroup", label: "VAT Prod. Posting Group", dim: true, render: (l) => dash(l.vatProdPostingGroup) },
  { key: "taxInvoiceNo", label: "Tax Invoice No.", mono: true, render: (l) => dash(l.taxInvoiceNo) },
  { key: "taxInvoiceDate", label: "Tax Invoice Date", dim: true, render: (l) => dash(l.taxInvoiceDate) },
  { key: "taxInvoiceBase", label: "Tax Invoice Base", numeric: true, render: (l) => (l.taxInvoiceBase != null ? fmtMoney(l.taxInvoiceBase) : "—") },
  { key: "taxInvoiceName", label: "Tax Invoice Name", render: (l) => dash(l.taxInvoiceName) },
  { key: "taxVatRegistrationNo", label: "Revolic VAT Registration No.", mono: true, render: (l) => dash(l.taxVatRegistrationNo) },
  { key: "taxVendorNo", label: "Tax Vendor No.", mono: true, render: (l) => dash(l.taxVendorNo) },
  { key: "taxBranchCode", label: "Branch Code (tax)", mono: true, render: (l) => dash(l.taxBranchCode) },
];

/** Columns with a value on at least one line. The tax block is empty on every
 *  line of a cash-bill clearing, and twelve blank columns would bury the rest. */
function shownCols(lines: ClrPreviewLine[]): BcCol[] {
  const cache = shownColsCache.get(lines);
  if (cache) return cache;
  const keep = BC_COLUMNS.filter((c) =>
    lines.some((l) => {
      const v = (l as unknown as Record<string, unknown>)[c.key];
      return v !== null && v !== undefined && v !== "";
    }),
  );
  shownColsCache.set(lines, keep);
  return keep;
}

/** Keyed by the array the modal already holds, so the render does not recompute
 *  the same answer once per row per column. */
const shownColsCache = new WeakMap<ClrPreviewLine[], BcCol[]>();

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
                  <div className="overflow-x-auto show-x-scroll pb-1">
                    <table className="text-[11px]" style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-card-alt)" }}>
                          {shownCols(item.lines).map((c) => (
                            <th key={c.key}
                              className={`px-2.5 py-1.5 font-semibold whitespace-nowrap ${c.numeric ? "text-right" : "text-left"}`}
                              style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border-light)" }}>
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {item.lines.map((line, idx) => (
                          <tr key={idx} style={{ borderBottom: "1px solid var(--border-light)" }}>
                            {shownCols(item.lines).map((c) => (
                              <td key={c.key}
                                className={`px-2.5 py-1.5 whitespace-nowrap ${c.numeric ? "text-right tabular-nums" : ""} ${c.mono ? "font-mono" : ""}`}
                                style={{ color: c.dim ? "var(--text-secondary)" : "var(--text-primary)" }}>
                                {c.render(line)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: "2px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
                          {shownCols(item.lines).map((c, i) => (
                            <td key={c.key}
                              className={`px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap ${c.numeric ? "text-right tabular-nums" : ""}`}
                              style={{ color: "var(--text-heading)" }}>
                              {c.key === "debit" ? fmtMoney(totalDebit)
                                : c.key === "credit" ? fmtMoney(totalCredit)
                                : i === 0 ? `รวม (${item.lines.length} บรรทัด)` : ""}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {(() => {
                    const hidden = BC_COLUMNS.filter((c) => !shownCols(item.lines).includes(c));
                    if (hidden.length === 0) return null;
                    return (
                      <p className="px-3 pt-2 text-[10px] leading-snug m-0" style={{ color: "var(--text-faint)" }}>
                        ไม่แสดง {hidden.length} คอลัมน์ที่ไม่มีค่าในใบนี้: {hidden.map((c) => c.label).join(" · ")}
                      </p>
                    );
                  })()}
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
  /** The row whose BC answer is on screen, if any. */
  const [bcRow, setBcRow] = useState<ClrErpQueueRow | null>(null);
  /** The row waiting for the pull-back confirmation. */
  const [pullbackRow, setPullbackRow] = useState<ClrErpQueueRow | null>(null);
  const [pullbackBusy, setPullbackBusy] = useState(false);
  /** The row waiting for the cancel confirmation, and the reason typed for it. */
  const [cancelRow, setCancelRow] = useState<ClrErpQueueRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
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
  const cancelledRows = useMemo(() => filteredByBrand.filter(isCancelled), [filteredByBrand]);
  /* A failure is not a send. It used to sit in "ส่งแล้ว" behind a red pill,
     counted in that tab's total, which read as work finished. */
  const sentRows = useMemo(
    () => filteredByBrand.filter((r) => !isCancelled(r) && (isSent(r) || isPending(r))),
    [filteredByBrand],
  );
  const failedRows = useMemo(
    () => filteredByBrand.filter((r) => !isCancelled(r) && r.erpStatus === "Failed"),
    [filteredByBrand],
  );
  const failedFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? failedRows.filter((r) => `${r.requestNo ?? ""} ${r.requesterFullName ?? ""}`.toLowerCase().includes(q))
      : failedRows;
  }, [failedRows, search]);

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

  /* Read through the ids that are sendable right now, never straight out of the
     Set. A tick outlives its row — cancelling a ticked "รอส่ง" row left the id
     behind, and the preview then drew a journal for a clearing that can never
     post. See effectiveSelection. */
  const selectedIds = effectiveSelection(selected, selectableIds);

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

  const doPullback = useCallback(async () => {
    if (!pullbackRow) return;
    setPullbackBusy(true);
    try {
      const res = await fetch("/api/request/clear-advance/erp/pullback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pullbackRow.id }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast.error(json.error ?? "ดึงกลับไม่สำเร็จ");
        return;
      }
      toast.success(`ดึงกลับแล้ว — ย้ายไปแท็บ “รอส่ง”`);
      setPullbackRow(null);
      setTab("pending");
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ดึงกลับไม่สำเร็จ");
    } finally {
      setPullbackBusy(false);
    }
  }, [pullbackRow, mutate]);

  const doCancel = useCallback(async () => {
    if (!cancelRow || !cancelReason.trim()) return;
    setCancelBusy(true);
    try {
      const res = await fetch("/api/request/clear-advance/erp/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cancelRow.id, reason: cancelReason.trim() }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast.error(json.error ?? "ยกเลิกไม่สำเร็จ");
        return;
      }
      toast.success("ยกเลิกแล้ว — ย้ายไปแท็บ “ยกเลิก”");
      setCancelRow(null);
      setCancelReason("");
      setTab("cancelled");
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    } finally {
      setCancelBusy(false);
    }
  }, [cancelRow, cancelReason, mutate]);

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
        {([
          ["pending", `รอส่ง (${sendableRows.length})`],
          ["sent", `ส่งแล้ว (${sentRows.length})`],
          ["failed", `ล้มเหลว (${failedRows.length})`],
          ["cancelled", `ยกเลิก (${cancelledRows.length})`],
        ] as const).map(([t, label]) => {
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
                      {["เลขที่", "แบรนด์", "ผู้ยื่น", "Advance", "ใช้จริง", "คืน/จ่ายเพิ่ม", "วันจ่าย", "สถานะ ERP", "Doc No", ""].map((h) => (
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
                          <td className="px-3 py-2 whitespace-nowrap"><ErpStatusBadge row={row} onShow={setBcRow} /></td>
                          <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                            {row.erpDocumentNo ?? <span style={{ color: "var(--text-faint)" }}>—</span>}
                          </td>
                          {/* A row can be stuck for a reason the portal cannot fix
                              — an AP-2 advance with no vendor that can no longer be
                              given one. Without this it waited in "รอส่ง" for ever. */}
                          <td className="px-3 py-2 whitespace-nowrap text-right">
                            <button type="button" onClick={() => { setCancelRow(row); setCancelReason(""); }}
                              className="text-[12px] font-medium px-2.5 py-1 rounded-lg cursor-pointer bg-transparent"
                              style={{ color: "var(--status-bad-text)", border: "1px solid color-mix(in srgb, var(--status-bad-text) 35%, transparent)" }}
                              title="ยกเลิกคำขอนี้ — จะย้ายไปแท็บ ยกเลิก">
                              ยกเลิก
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-10">
                    <tr style={{ borderTop: "2px solid var(--border-card)", background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-page))", boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)" }}>
                      <td colSpan={11} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
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
                          <td className="px-3 py-2 whitespace-nowrap"><ErpStatusBadge row={row} onShow={setBcRow} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-10">
                    <tr style={{ borderTop: "2px solid var(--border-card)", background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-page))", boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)" }}>
                      <td colSpan={10} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
                        ทั้งหมด {sentFiltered.length} รายการ · ส่งแล้ว {sentFiltered.filter(isSent).length}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ล้มเหลว tab ── */}
      {tab === "failed" && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา เลขที่ / ผู้ยื่น"
                className="text-[12px] rounded-lg pl-7 pr-3 py-2 outline-none w-[220px]"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-input)", color: "var(--text-primary)" }} />
            </div>
            <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
              {failedFiltered.length} รายการ
            </span>
          </div>

          {failedFiltered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center rounded-xl"
              style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)" }}>
              <FileX size={32} style={{ color: "var(--text-muted)" }} />
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่มีรายการที่ล้มเหลว 🎉</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
              <div className="overflow-x-auto no-scrollbar max-h-[min(72vh,760px)] overflow-y-auto" style={{ background: "var(--bg-card)" }}>
                <table className="w-full text-[12px] border-collapse min-w-[1100px]">
                  <thead className="sticky top-0 z-10"
                    style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}>
                    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                      {["เลขที่", "แบรนด์", "ผู้ยื่น", "Advance", "ใช้จริง", "Error จาก BC", "สถานะ", ""].map((h) => (
                        <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap text-left"
                          style={{ color: "var(--text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {failedFiltered.map((row, idx) => {
                      const rowBg = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-page))";
                      return (
                        <tr key={row.id} style={{ background: rowBg, borderBottom: "1px solid var(--border-light)" }}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="font-semibold" style={{ color: "var(--nav-active-text)" }}>{row.requestNo ?? `#${row.id}`}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.brandCode ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{row.requesterFullName ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.advanceRequestNo ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                            {row.actualTotal != null ? row.actualTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 }) : "—"}
                          </td>
                          {/* The reason, on the row. Two lines of it — the whole
                              answer is a click away and does not belong in a cell. */}
                          <td className="px-3 py-2 align-top" style={{ maxWidth: "26rem" }}>
                            <button
                              type="button"
                              onClick={() => setBcRow(row)}
                              className="text-left text-[11px] cursor-pointer bg-transparent border-none p-0 underline"
                              style={{
                                color: "var(--status-bad-text)", display: "-webkit-box",
                                WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                              }}
                              title="ดูคำตอบจาก BC ทั้งหมด"
                            >
                              {row.erpError ?? "—"}
                            </button>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap"><ErpStatusBadge row={row} onShow={setBcRow} /></td>
                          <td className="px-3 py-2 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" onClick={() => setPullbackRow(row)}
                                className="text-[12px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer border-none"
                                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                                title="ล้างสถานะและย้ายกลับไปแท็บ รอส่ง">
                                ดึงกลับเพื่อยิงใหม่
                              </button>
                              <button type="button" onClick={() => { setCancelRow(row); setCancelReason(""); }}
                                className="text-[12px] font-medium px-2.5 py-1 rounded-lg cursor-pointer bg-transparent"
                                style={{ color: "var(--status-bad-text)", border: "1px solid color-mix(in srgb, var(--status-bad-text) 35%, transparent)" }}
                                title="เลิกส่งใบนี้ — จะย้ายไปแท็บ ยกเลิก">
                                ยกเลิก
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ยกเลิก tab ── */}
      {tab === "cancelled" && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-heading)" }}>
              ยกเลิกก่อนส่งเข้า ERP ({cancelledRows.length} รายการ)
            </span>
            <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
              เงินทดรองจ่ายของใบที่ยกเลิกจะกลับไปเคลียร์ใหม่ได้
            </span>
          </div>

          {cancelledRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center rounded-xl"
              style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)" }}>
              <FileX size={32} style={{ color: "var(--text-muted)" }} />
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่มีรายการที่ยกเลิก</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
              <div className="overflow-x-auto no-scrollbar max-h-[min(72vh,760px)] overflow-y-auto" style={{ background: "var(--bg-card)" }}>
                <table className="w-full text-[12px] border-collapse min-w-[900px]">
                  <thead className="sticky top-0 z-10"
                    style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}>
                    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                      {["เลขที่", "แบรนด์", "ผู้ยื่น", "Advance", "ใช้จริง", "วันที่ยกเลิก", "เหตุผล"].map((h) => (
                        <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap text-left"
                          style={{ color: "var(--text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cancelledRows.map((row, idx) => {
                      const rowBg = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-page))";
                      return (
                        <tr key={row.id} style={{ background: rowBg, borderBottom: "1px solid var(--border-light)" }}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="font-semibold" style={{ color: "var(--nav-active-text)" }}>{row.requestNo ?? `#${row.id}`}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.brandCode ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{row.requesterFullName ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.advanceRequestNo ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                            {fmtMoney(row.actualTotal)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                            {fmtDateTime(row.cancelledAt)}
                          </td>
                          <td className="px-3 py-2" style={{ color: "var(--text-secondary)", maxWidth: "24rem" }}>
                            {row.cancelNote ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Cancelling ends a request people are waiting on, and the requester is
          told the reason — so the reason is required here rather than optional. */}
      {cancelRow && (
        <Dialog
          open={!!cancelRow}
          onOpenChange={(o) => { if (!o && !cancelBusy) { setCancelRow(null); setCancelReason(""); } }}
          title="ยกเลิกคำขอนี้?"
          contentClassName="max-w-[520px]"
        >
          <div className="flex flex-col gap-3 p-1">
            <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
              <b style={{ color: "var(--text-heading)" }}>{cancelRow.requestNo ?? `#${cancelRow.id}`}</b>{" "}
              จะถูกยกเลิกและย้ายไปแท็บ “ยกเลิก” — ส่งเข้า ERP ไม่ได้อีก
              และเงินทดรองจ่าย {cancelRow.advanceRequestNo ?? "ของใบนี้"} จะกลับไปเคลียร์ใหม่ได้
            </p>
            {cancelRow.erpStatus === "Failed" && (
              <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                ⚠️ ใบนี้เคยส่งแล้วล้มเหลว — ถ้า BC รับบางบรรทัดไว้ เอกสารที่ค้างใน Journal Batch
                <b> ต้องไปลบใน BC เอง</b> การยกเลิกที่นี่ไม่แตะ Business Central
              </p>
            )}
            <label className="text-[12px] font-semibold" style={{ color: "var(--text-heading)" }}>
              เหตุผลที่ยกเลิก *
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder="เช่น ใบเบิก AP-2 ไม่มี Vendor และแก้ไม่ได้ — ให้ผู้ขอยื่นใหม่"
                className="mt-1 w-full text-[13px] rounded-lg px-3 py-2 outline-none resize-none font-normal"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-input)", color: "var(--text-primary)" }}
              />
            </label>
            <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
              ผู้ขอจะได้รับอีเมลแจ้งพร้อมเหตุผลนี้
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={cancelBusy} onClick={() => { setCancelRow(null); setCancelReason(""); }}
                className="text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
                ไม่ยกเลิก
              </button>
              <button type="button" disabled={cancelBusy || !cancelReason.trim()} onClick={doCancel}
                className="text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{
                  background: "var(--status-bad-text)", color: "#fff", border: "none",
                  opacity: cancelBusy || !cancelReason.trim() ? 0.55 : 1,
                  cursor: cancelBusy || !cancelReason.trim() ? "not-allowed" : "pointer",
                }}>
                {cancelBusy ? "กำลังยกเลิก..." : "ยืนยันยกเลิก"}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* preview modal */}
      {previewItems && (
        <ClrErpPreviewModal items={previewItems} onClose={() => setPreviewItems(null)} />
      )}

      {/* Send confirmation — the same popup AP-2 uses, in place of the browser's
          own confirm(), which could say nothing about where the journal was
          bound for. Sending into Production reads differently from Sandbox and
          the dialog has to make that visible while it can still be stopped. */}
      {/* Pulling back changes our record and nothing in BC — which is the whole
          risk, so the dialog says it rather than the tooltip. */}
      {pullbackRow && (
        <Dialog
          open={!!pullbackRow}
          onOpenChange={(o) => { if (!o && !pullbackBusy) setPullbackRow(null); }}
          title="ดึงกลับเพื่อยิงใหม่?"
          contentClassName="max-w-[520px]"
        >
          <div className="flex flex-col gap-3 p-1">
            <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
              <b style={{ color: "var(--text-heading)" }}>{pullbackRow.requestNo ?? `#${pullbackRow.id}`}</b>{" "}
              จะถูกล้างสถานะ ERP และย้ายกลับไปแท็บ “รอส่ง” เพื่อส่งใหม่
            </p>
            <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
              style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
              ⚠️ การดึงกลับ <b>ไม่แตะ Business Central</b> — ถ้าครั้งก่อน BC รับบางบรรทัดไว้แล้ว
              (เช่น “Inserted: 3, Failed: 1”) เอกสารที่ค้างอยู่ใน Journal Batch จะยังอยู่
              และการยิงใหม่จะเพิ่มอีกชุด <b>ต้องลบเอกสารเดิมใน BC ก่อน</b>
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={pullbackBusy} onClick={() => setPullbackRow(null)}
                className="text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
                ยกเลิก
              </button>
              <button type="button" disabled={pullbackBusy} onClick={doPullback}
                className="text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)", border: "none", opacity: pullbackBusy ? 0.7 : 1 }}>
                {pullbackBusy ? "กำลังดึงกลับ..." : "ยืนยันดึงกลับ"}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* What BC said, in BC's words. The derived summary is above it because it
          is the sentence someone can act on; the raw answer is below because it
          is the one nobody can argue with. */}
      {bcRow && (
        <Dialog
          open={!!bcRow}
          onOpenChange={(o) => { if (!o) setBcRow(null); }}
          title={`คำตอบจาก Business Central — ${bcRow.requestNo ?? bcRow.id}`}
          contentClassName="max-w-[720px]"
        >
          <div className="flex flex-col gap-3 p-1">
            <div className="flex items-center gap-2 flex-wrap text-[12px]" style={{ color: "var(--text-muted)" }}>
              <span>{bcRow.erpEnvironment ?? "—"}</span>
              <span>·</span>
              <span>Doc No: <b style={{ color: "var(--text-secondary)" }}>{bcRow.erpDocumentNo ?? "—"}</b></span>
              <span>·</span>
              <span>{fmtDateTime(bcRow.erpSentAt)}</span>
            </div>

            {bcRow.erpError && (
              <div className="rounded-lg px-3 py-2 text-[12px]"
                style={{ background: "var(--bg-info-red)", color: "var(--status-bad-text)" }}>
                {bcRow.erpError}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Response ดิบ
              </span>
              <pre
                className="text-[11px] m-0 p-3 rounded-lg overflow-auto"
                style={{
                  background: "var(--bg-input)", color: "var(--text-primary)",
                  border: "1px solid var(--border-input)", maxHeight: "22rem", whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {prettyJson(bcRow.erpResponse) ?? "— ไม่มีคำตอบที่บันทึกไว้ (ส่งก่อนที่ระบบจะเริ่มเก็บ) —"}
              </pre>
            </div>

            <div className="flex justify-end gap-2">
              {bcRow.erpResponse && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(bcRow.erpResponse ?? "");
                    toast.success("คัดลอกแล้ว");
                  }}
                  className="text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                  style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
                >
                  คัดลอก
                </button>
              )}
              <button
                type="button"
                onClick={() => setBcRow(null)}
                className="text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)", border: "none" }}
              >
                ปิด
              </button>
            </div>
          </div>
        </Dialog>
      )}

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
