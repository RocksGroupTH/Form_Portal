"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FileBarChart, Search, X, Download } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { ColumnToggleMenu, type ColumnToggleOption } from "@/features/travel-booking/components/ColumnToggleMenu";
import { AdvanceDetailPanel } from "@/features/advance/components/AdvanceDetailPanel";
import {
  DEFAULT_VISIBLE_KEYS,
  TABLE_EXCLUDED_KEYS,
  clearingStatusLabel,
  clearingStatusTone,
  computeTileCounts,
  isAwaitingApproval,
  isAwaitingErp,
  isOverdueClearing,
  overallStatusTone,
  todayYmd,
  totalAmountThb,
  type Row,
  type StatusTone,
} from "@/lib/adv/advance-report-view";

// `th-TH` alone renders the Buddhist calendar — 2026 comes out as 69 — which is
// what the AP-2 date pickers were moved off. `-u-ca-gregory` keeps Thai
// formatting but counts the years the way the ERP and the stored ISO dates do.
// The year is spelled out: `dateStyle: "short"` abbreviates it to 26, which
// reads as ambiguous next to a day and a month that are also two digits.
const TH_CE = "th-TH-u-ca-gregory";
const YMD = { day: "2-digit", month: "2-digit", year: "numeric" } as const;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString(TH_CE, { ...YMD, hour: "2-digit", minute: "2-digit" }) : "");
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString(TH_CE, YMD) : "");
const n = (v: number | null) => (v == null ? "" : v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

/** A coloured pill for the status columns — the three-tone palette already in
 *  globals.css (`--status-{ok,pending,bad}-*`), nothing new. */
function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  const style: React.CSSProperties =
    tone === "ok"
      ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
      : tone === "bad"
        ? { background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }
        : { background: "var(--status-pending-bg)", color: "var(--status-pending-text)" };
  return (
    <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={style}>
      {label}
    </span>
  );
}

/** One of the four summary tiles. Rendered as a real `<button>` even when
 *  informational (`onClick` omitted) — a `disabled` button keeps `title`
 *  accessible and avoids a `div`/`button` prop-type split, and the inline
 *  styles below override the disabled look so it does not read as inert. */
function CountTile({
  label, value, tone, active, onClick, ariaLabel,
}: {
  label: string; value: string | number; tone: StatusTone; active?: boolean; onClick?: () => void; ariaLabel: string;
}) {
  const toneText = tone === "ok" ? "var(--status-ok-text)" : tone === "bad" ? "var(--status-bad-text)" : "var(--status-pending-text)";
  const toneBg = tone === "ok" ? "var(--status-ok-bg)" : tone === "bad" ? "var(--status-bad-bg)" : "var(--status-pending-bg)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={ariaLabel}
      aria-label={ariaLabel}
      aria-pressed={onClick ? !!active : undefined}
      className={`flex flex-col gap-1 rounded-2xl px-4 py-3 text-left border-none ${onClick ? "cursor-pointer" : "cursor-default"}`}
      style={{
        background: active ? toneBg : "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
        outline: `1px solid ${active ? toneText : "var(--border-card)"}`,
        outlineOffset: -1,
      }}
    >
      <span className="text-[11px] font-semibold" style={{ color: active ? toneText : "var(--text-muted)" }}>{label}</span>
      <span className="text-[22px] font-bold" style={{ color: active ? toneText : "var(--text-heading)" }}>{value}</span>
    </button>
  );
}

const PAYEE_TYPE_OPTIONS = [
  { value: "", label: "โอนให้: ทั้งหมด" },
  { value: "คู่ค้า", label: "คู่ค้า" },
  { value: "พนักงาน", label: "พนักงาน" },
] as const;

type Col = {
  key: string; h: string; get: (r: Row) => string; num?: boolean;
  filter?: "text" | "select" | "dates"; rawDate?: (r: Row) => string | null;
  /** On-screen table/picker heading, when it should read differently from the
   *  Excel export header (`h`) — e.g. a shorter Thai default-column heading.
   *  Falls back to `h`. Never affects the export. */
  screenLabel?: string;
  /** On-screen cell rendering (status chips). Falls back to `get(r)` as plain
   *  text. The Excel export always calls `get` directly, never this, so the
   *  exported value cannot silently drift from what the screen shows. */
  render?: (r: Row) => React.ReactNode;
  /** Value used for the header-row filter / its select options, when it must
   *  differ from `get` (a derived display bucket rather than the raw export
   *  value). Falls back to `get`. */
  filterValue?: (r: Row) => string;
};

// filter → คอลัมน์ไฮไลต์เหลืองใน sheet AP-2-Control ("dates" = เลือกได้หลายวัน)
const COLS: Col[] = [
  { key: "submittedAt", h: "Submitted", screenLabel: "วันที่ส่ง", get: (r) => dt(r.submittedAt) },
  { key: "requestNo", h: "เลขที่ Request", screenLabel: "เลขที่ ADV", get: (r) => r.requestNo ?? "", filter: "text" },
  { key: "staffId", h: "รหัสพนักงาน", get: (r) => String(r.staffId ?? ""), filter: "text" },
  { key: "requesterName", h: "ชื่อ-นามสกุล", screenLabel: "ผู้ขอ", get: (r) => r.requesterName ?? "", filter: "text" },
  { key: "position", h: "ตำแหน่ง", get: (r) => r.position ?? "" },
  { key: "department", h: "แผนก", get: (r) => r.department ?? "" },
  // Excluded from the on-screen table (TABLE_EXCLUDED_KEYS) — filtered instead
  // via the toolbar toggle below, not a per-column box. Left in COLS
  // unchanged so the export keeps its 28th column exactly as before.
  { key: "payeeType", h: "โอนให้", get: (r) => r.payeeType ?? "" },
  { key: "payeeName", h: "ชื่อคู่ค้า/พนักงาน", screenLabel: "ผู้รับเงิน", get: (r) => r.payeeName ?? "" },
  { key: "bankAccount", h: "เลขที่บัญชี", get: (r) => r.bankAccount ?? "" },
  { key: "bankName", h: "ธนาคาร", get: (r) => r.bankName ?? "" },
  { key: "needByDate", h: "วันที่เริ่มใช้เงิน", get: (r) => d(r.needByDate) },
  { key: "expectedClearDate", h: "วันที่คาดเคลียร์", screenLabel: "วันคาดเคลียร์", get: (r) => d(r.expectedClearDate), filter: "dates", rawDate: (r) => r.expectedClearDate },
  { key: "purpose", h: "รายละเอียด", get: (r) => r.purpose ?? "" },
  { key: "currency", h: "สกุลเงิน", get: (r) => r.currency ?? "" },
  { key: "amount", h: "จำนวนเงิน", get: (r) => n(r.amount), num: true },
  { key: "exchangeRate", h: "อัตราแลกเปลี่ยน", get: (r) => n(r.exchangeRate), num: true },
  { key: "baseAmount", h: "เบิก Advance (THB)", screenLabel: "ยอด (THB)", get: (r) => n(r.baseAmount), num: true },
  { key: "approvedName", h: "Approved Name", get: (r) => r.approvedName ?? "" },
  { key: "approvedDate", h: "Approved Date", get: (r) => dt(r.approvedDate) },
  { key: "approvedRemark", h: "Approved Remark", get: (r) => r.approvedRemark ?? "" },
  { key: "actionedByName", h: "Actioned By", get: (r) => r.actionedByName ?? "" },
  { key: "actionedDate", h: "Actioned Date", get: (r) => dt(r.actionedDate) },
  { key: "actionedRemark", h: "Actioned Remark", get: (r) => r.actionedRemark ?? "", filter: "text" },
  // A date filter, not a text one: payments land on the 2nd and 4th Friday, so
  // picking rounds is how accounting narrows a report to a payment week.
  { key: "paymentDate", h: "Payment Date", screenLabel: "วันจ่าย", get: (r) => d(r.paymentDate), filter: "dates", rawDate: (r) => r.paymentDate },
  { key: "clearAdvanceNo", h: "Clear Advance no.", screenLabel: "เลขที่ ADC", get: (r) => r.clearAdvanceNo ?? "", filter: "text" },
  {
    key: "advanceStatus", h: "Advance status", screenLabel: "สถานะเคลียร์",
    get: (r) => r.advanceStatus ?? "",
    filter: "select",
    // Filter/select-options operate on the 4-state display bucket, not the raw
    // label — that is what lets "no AP-3 yet" (a blank raw value) be filtered
    // on at all. `get` is untouched, so the Excel export is unaffected.
    filterValue: (r) => clearingStatusLabel(r.advanceStatus),
    render: (r) => {
      const label = clearingStatusLabel(r.advanceStatus);
      return <StatusChip label={label} tone={clearingStatusTone(label)} />;
    },
  },
  { key: "pendingOn", h: "Pending on", screenLabel: "รอที่ใคร", get: (r) => r.pendingOn ?? "" },
  {
    key: "overallStatus", h: "Overall Status", screenLabel: "สถานะรวม",
    get: (r) => r.overallStatus, filter: "select",
    render: (r) => <StatusChip label={r.overallStatus} tone={overallStatusTone(r.overallStatus)} />,
  },
];

/** Columns actually eligible for the on-screen table / picker — `payeeType`
 *  left the table for good (see its COLS comment above). */
const OFFERED_COLS: Col[] = COLS.filter((c) => !TABLE_EXCLUDED_KEYS.includes(c.key));

const DEFAULT_VISIBLE: Record<string, boolean> = OFFERED_COLS.reduce(
  (acc, c) => ({ ...acc, [c.key]: DEFAULT_VISIBLE_KEYS.includes(c.key) }),
  {} as Record<string, boolean>,
);

const PICKER_COLUMNS: ColumnToggleOption<string>[] = OFFERED_COLS.map((c) => ({ key: c.key, label: c.screenLabel ?? c.h }));

const COLS_STORAGE_KEY = "ap2-report-cols";

function loadStoredVisibility(): Record<string, boolean> {
  if (typeof window === "undefined") return DEFAULT_VISIBLE;
  try {
    const raw = window.localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...DEFAULT_VISIBLE, ...parsed };
  } catch {
    return DEFAULT_VISIBLE;
  }
}

export default function AdvanceReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [overdueOnly, setOverdueOnly] = useState(false);
  /** Mutually exclusive with itself only — a row can't be both awaiting
   *  approval and awaiting an ERP send, so this is a single radio-like value
   *  rather than two independent booleans. Orthogonal to `overdueOnly`. */
  const [focus, setFocus] = useState<"none" | "awaitingApproval" | "awaitingErp">("none");
  const [visible, setVisible] = useState<Record<string, boolean>>(DEFAULT_VISIBLE);
  /* Detail drawer — click a row to inspect the request without losing the
     report's filters (design doc §"Reading a row"). */
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/report")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: Row[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  useEffect(() => {
    setVisible(loadStoredVisibility());
  }, []);

  const handleVisibleChange = useCallback((next: Record<string, boolean>) => {
    setVisible(next);
    try {
      window.localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // best-effort — ignore storage failures (private mode / quota)
    }
  }, []);

  const visibleColumns = useMemo(() => OFFERED_COLS.filter((c) => visible[c.key] ?? true), [visible]);

  // distinct options for select filters — built off the display value
  // (filterValue) where a column has one, so advanceStatus offers the four
  // clearing states rather than the raw export label.
  const selectOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of COLS.filter((x) => x.filter === "select")) {
      const getValue = c.filterValue ?? c.get;
      map[c.key] = Array.from(new Set(rows.map((r) => getValue(r)).filter(Boolean))).sort();
    }
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayYmd();
    return rows.filter((r) => {
      if (overdueOnly && !isOverdueClearing(r, today)) return false;
      if (focus === "awaitingApproval" && !isAwaitingApproval(r)) return false;
      if (focus === "awaitingErp" && !isAwaitingErp(r)) return false;
      // ค้นหาเอกสาร: เลขที่ Request / ชื่อ / รหัสพนักงาน
      if (q) {
        const hay = `${r.requestNo ?? ""} ${r.requesterName ?? ""} ${r.staffId ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      for (const c of COLS) {
        const f = filters[c.key];
        if (!f) continue;
        if (c.filter === "dates") {
          const sel = f.split(",").filter(Boolean);
          const raw = c.rawDate?.(r) ?? null;
          if (sel.length && (!raw || !sel.includes(raw))) return false;
          continue;
        }
        const getValue = c.filterValue ?? c.get;
        const v = getValue(r).toLowerCase();
        if (c.filter === "select") {
          // Multi-value, stored as CSV like the date filter: any selected value
          // matches, so a report can cover two statuses at once. `payeeType`'s
          // toolbar toggle also lands here (a single-value CSV of length 1).
          const sel = f.split(",").filter(Boolean).map((s) => s.toLowerCase());
          if (sel.length && !sel.includes(v)) return false;
        }
        else if (!v.includes(f.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, search, filters, overdueOnly, focus]);

  /** Standing counts over the whole dataset, so the tiles read as KPIs rather
   *  than a reflection of whatever else is filtered right now. */
  const tileCounts = useMemo(() => computeTileCounts(rows, todayYmd()), [rows]);
  /** Sum of the currently-filtered rows — this one *does* track the filters,
   *  answering "how much am I looking at" (design doc §"Summary tiles"). */
  const totalThb = useMemo(() => totalAmountThb(filtered), [filtered]);

  // Export เฉพาะข้อมูลที่กรองอยู่ (filtered) เป็น .xlsx — all 28 columns, current
  // AP-2-Control order, regardless of which are shown on screen right now.
  function exportExcel() {
    if (filtered.length === 0) return;
    const header = COLS.map((c) => c.h);
    const body = filtered.map((r) =>
      COLS.map((c) => {
        const s = c.get(r);
        if (c.num) return s === "" ? "" : Number(s.replace(/,/g, ""));
        return s;
      }),
    );
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = COLS.map((c) => ({ wch: Math.min(40, Math.max(10, c.h.length + 4)) }));
    // หัวตารางตัวหนา
    for (let i = 0; i < header.length; i++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: i })];
      if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: "FFF2CC" } } };
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "AP-2 Control");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `AP-2-Report-${stamp}.xlsx`);
  }

  const activeFilters =
    Object.values(filters).filter(Boolean).length + (search.trim() ? 1 : 0) + (overdueOnly ? 1 : 0) + (focus !== "none" ? 1 : 0);
  const setF = (k: string, v: string) => setFilters((p) => ({ ...p, [k]: v }));
  /** Add one value to a CSV-valued filter — shared by the date and select filters. */
  const addValue = (k: string, v: string) => setFilters((p) => {
    const cur = (p[k] ?? "").split(",").filter(Boolean);
    if (!cur.includes(v)) cur.push(v);
    return { ...p, [k]: cur.sort().join(",") };
  });
  const removeValue = (k: string, v: string) => setFilters((p) => ({
    ...p, [k]: (p[k] ?? "").split(",").filter(Boolean).filter((x) => x !== v).join(","),
  }));

  const th: React.CSSProperties = {
    background: "var(--bg-card-alt)", color: "var(--text-secondary)", padding: "8px 10px",
    textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--border-card)",
    position: "sticky", top: 0, zIndex: 2, fontWeight: 700,
  };
  const fth: React.CSSProperties = {
    background: "var(--bg-card)", padding: "4px 6px", whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border-card)", position: "sticky", top: 34, zIndex: 2,
  };
  const td: React.CSSProperties = {
    padding: "7px 10px", whiteSpace: "nowrap", borderBottom: "1px solid var(--border-card)",
    color: "var(--text-primary)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis",
  };
  const fInput = "w-full text-[11px] px-2 py-1 rounded-md outline-none";
  const fStyle: React.CSSProperties = { background: "var(--bg-input, var(--bg-card-alt))", color: "var(--text-primary)", border: "1px solid var(--border-card)" };

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0 flex flex-col gap-4">
      <PageHeaderBar
        icon={FileBarChart}
        title="รายงาน AP-2 (Control)"
        subtitle="คำขอเบิกเงินทดรองจ่ายทั้งหมด · คอลัมน์ตาม AP-2-Control"
        backHref="/request/advance/admin"
      />

      {/* สรุปยอด — คลิกเพื่อกรอง ยกเว้นยอดรวม (design doc §"Summary tiles that filter") */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CountTile
          label="รออนุมัติ" value={tileCounts.awaitingApproval} tone="pending"
          active={focus === "awaitingApproval"}
          onClick={() => setFocus((f) => (f === "awaitingApproval" ? "none" : "awaitingApproval"))}
          ariaLabel="รออนุมัติ — อยู่ระหว่างขั้นตอนอนุมัติ"
        />
        <CountTile
          label="รอส่ง ERP" value={tileCounts.awaitingErp} tone="pending"
          active={focus === "awaitingErp"}
          onClick={() => setFocus((f) => (f === "awaitingErp" ? "none" : "awaitingErp"))}
          ariaLabel="รอส่ง ERP — อนุมัติผ่านสายอนุมัติแล้ว รอ Accounting Officer ส่งเข้า ERP"
        />
        <CountTile
          label="ค้างเคลียร์เกินกำหนด" value={tileCounts.overdue} tone="bad"
          active={overdueOnly}
          onClick={() => setOverdueOnly((v) => !v)}
          ariaLabel="ค้างเคลียร์เกินกำหนด — เบิกแล้วอนุมัติ แต่ยังไม่มีการเคลียร์ที่อนุมัติ และเลยวันที่คาดเคลียร์แล้ว"
        />
        <CountTile
          label="ยอดรวม (THB)" value={`${n(totalThb)} ฿`} tone="ok"
          ariaLabel="ยอดรวม (THB) ของรายการที่กรองอยู่ในขณะนี้"
        />
      </div>

      {/* ค้นหาเอกสาร + ตัวกรอง + คอลัมน์ + export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1 min-w-[240px]"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <Search size={15} style={{ color: "var(--text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเอกสาร (เลขที่ Request / ชื่อ / รหัสพนักงาน)..."
            className="flex-1 text-[13px] outline-none bg-transparent" style={{ color: "var(--text-primary)" }} />
        </div>

        {/* โอนให้ ("payeeType") left the table for this toggle — design doc §"Default columns" */}
        <div className="inline-flex rounded-xl overflow-hidden text-[12px] font-semibold" style={{ border: "1px solid var(--border-card)" }}>
          {PAYEE_TYPE_OPTIONS.map((opt) => (
            <button key={opt.value || "all"} type="button" onClick={() => setF("payeeType", opt.value)}
              className="px-3 py-2 cursor-pointer border-none whitespace-nowrap"
              style={{
                background: (filters.payeeType ?? "") === opt.value ? "var(--nav-active-bg)" : "var(--bg-card)",
                color: (filters.payeeType ?? "") === opt.value ? "var(--nav-active-text)" : "var(--text-secondary)",
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        <ColumnToggleMenu columns={PICKER_COLUMNS} visible={visible} onChange={handleVisibleChange} label="คอลัมน์" />

        {activeFilters > 0 && (
          <button onClick={() => { setSearch(""); setFilters({}); setOverdueOnly(false); setFocus("none"); }}
            className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-xl cursor-pointer border-none"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}>
            <X size={13} /> ล้างตัวกรอง ({activeFilters})
          </button>
        )}
        <button onClick={exportExcel} disabled={loading || filtered.length === 0}
          className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-xl cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "var(--color-action, var(--nav-active-text))", color: "#fff" }}>
          <Download size={14} /> Export Excel
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}>
        {loading ? (
          <p className="text-[13px] py-16 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] py-16 text-center" style={{ color: "var(--text-muted)" }}>ยังไม่มีคำขอ</p>
        ) : (
          <div className="overflow-auto" style={{ maxHeight: "72vh" }}>
            <table className="text-[12px]" style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>{visibleColumns.map((c) => <th key={c.key} style={th}>{c.screenLabel ?? c.h}</th>)}</tr>
                <tr>
                  {visibleColumns.map((c) => (
                    <td key={c.key} style={fth}>
                      {c.filter === "text" ? (
                        <input value={filters[c.key] ?? ""} onChange={(e) => setF(c.key, e.target.value)}
                          placeholder="กรอง..." className={fInput} style={fStyle} />
                      ) : c.filter === "select" ? (
                        // Pick repeatedly to build a set; each pick becomes a chip.
                        <div className="flex flex-col gap-1 min-w-[130px]">
                          <select value="" onChange={(e) => { if (e.target.value) addValue(c.key, e.target.value); e.target.value = ""; }}
                            className={fInput} style={fStyle}>
                            <option value="">ทั้งหมด</option>
                            {(selectOptions[c.key] ?? [])
                              .filter((o) => !(filters[c.key] ?? "").split(",").includes(o))
                              .map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                          {(filters[c.key] ?? "").split(",").filter(Boolean).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {(filters[c.key] ?? "").split(",").filter(Boolean).map((sv) => (
                                <span key={sv} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded"
                                  style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                                  {sv}
                                  <button type="button" aria-label={`ลบตัวกรอง ${sv}`} onClick={() => removeValue(c.key, sv)}
                                    className="border-none bg-transparent cursor-pointer p-0 leading-none" style={{ color: "inherit" }}>×</button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : c.filter === "dates" ? (
                        <div className="flex flex-col gap-1 min-w-[130px]">
                          <input type="date" className={fInput} style={fStyle}
                            onChange={(e) => { if (e.target.value) addValue(c.key, e.target.value); e.target.value = ""; }} />
                          {(filters[c.key] ?? "").split(",").filter(Boolean).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {(filters[c.key] ?? "").split(",").filter(Boolean).map((dv) => (
                                <span key={dv} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded"
                                  style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                                  {new Date(dv).toLocaleDateString(TH_CE, { day: "2-digit", month: "2-digit" })}
                                  <button type="button" aria-label={`ลบตัวกรองวันที่ ${dv}`} onClick={() => removeValue(c.key, dv)}
                                    className="border-none bg-transparent cursor-pointer p-0 leading-none" style={{ color: "inherit" }}>×</button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}
                    role="button" tabIndex={0}
                    onClick={() => setDetailId(r.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailId(r.id); } }}
                    className="cursor-pointer hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
                    style={{ background: "var(--bg-card)" }}>
                    {visibleColumns.map((c) => (
                      <td key={c.key} style={{ ...td, textAlign: c.num ? "right" : "left", fontWeight: c.key === "requestNo" ? 700 : 400 }} title={c.get(r)}>
                        {c.render ? c.render(r) : c.get(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
        {loading ? "" : `แสดง ${filtered.length} / ${rows.length} รายการ`} · คลิกแถวเพื่อดูรายละเอียด · ช่องกรองใต้หัวตาราง = คอลัมน์ที่ filter ได้ (ตาม AP-2-Control)
      </p>

      <AdvanceDetailPanel requestId={detailId} onClose={() => setDetailId(null)} onChanged={load} />
    </PageContainer>
  );
}
