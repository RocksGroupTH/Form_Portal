"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FileBarChart, Search, X, Download } from "lucide-react";
import * as XLSX from "xlsx-js-style";

interface Row {
  id: number;
  submittedAt: string | null;
  requestNo: string | null;
  staffId: number | null;
  requesterName: string | null;
  position: string | null;
  department: string | null;
  payeeType: string | null;
  payeeName: string | null;
  bankAccount: string | null;
  bankName: string | null;
  needByDate: string | null;
  expectedClearDate: string | null;
  purpose: string | null;
  currency: string | null;
  amount: number | null;
  exchangeRate: number | null;
  baseAmount: number | null;
  approvedName: string | null;
  approvedDate: string | null;
  approvedRemark: string | null;
  actionedByName: string | null;
  actionedDate: string | null;
  actionedRemark: string | null;
  paymentDate: string | null;
  clearAdvanceNo: string | null;
  advanceStatus: string | null;
  pendingOn: string | null;
  overallStatus: string;
}

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "");
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString("th-TH", { dateStyle: "short" }) : "");
const n = (v: number | null) => (v == null ? "" : v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

// filter → คอลัมน์ไฮไลต์เหลืองใน sheet AP-2-Control ("dates" = เลือกได้หลายวัน)
/** Labels the report service produces — matched, never re-derived, so the two stay in step. */
const STATUS_APPROVED = "อนุมัติแล้ว (Completed)";
const CLEAR_STATUS_CLEARED = "เคลียร์แล้ว (Cleared)";

/** Local YYYY-MM-DD — comparing ISO date strings avoids a timezone round-trip. */
const todayYmd = (): string => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/**
 * An advance the company is still owed a clearing for, past its due date.
 *
 * All three must hold:
 *  - the advance was **approved** — money actually went out, so a clearing is
 *    genuinely owed; a rejected or cancelled request owes nothing and must not
 *    be chased.
 *  - there is no **approved** AP-3 against it. `advanceStatus` is null when no
 *    clearing exists at all and "กำลังเคลียร์" while one is in flight — neither
 *    settles the advance.
 *  - the promised clear date has already passed.
 */
function isOverdueClearing(r: Row, today: string): boolean {
  if (r.overallStatus !== STATUS_APPROVED) return false;
  if (r.advanceStatus === CLEAR_STATUS_CLEARED) return false;
  return !!r.expectedClearDate && r.expectedClearDate < today;
}

type Col = {
  key: string; h: string; get: (r: Row) => string; num?: boolean;
  filter?: "text" | "select" | "dates"; rawDate?: (r: Row) => string | null;
};
const COLS: Col[] = [
  { key: "submittedAt", h: "Submitted", get: (r) => dt(r.submittedAt) },
  { key: "requestNo", h: "เลขที่ Request", get: (r) => r.requestNo ?? "", filter: "text" },
  { key: "staffId", h: "รหัสพนักงาน", get: (r) => String(r.staffId ?? ""), filter: "text" },
  { key: "requesterName", h: "ชื่อ-นามสกุล", get: (r) => r.requesterName ?? "", filter: "text" },
  { key: "position", h: "ตำแหน่ง", get: (r) => r.position ?? "" },
  { key: "department", h: "แผนก", get: (r) => r.department ?? "" },
  { key: "payeeType", h: "โอนให้", get: (r) => r.payeeType ?? "", filter: "select" },
  { key: "payeeName", h: "ชื่อคู่ค้า/พนักงาน", get: (r) => r.payeeName ?? "" },
  { key: "bankAccount", h: "เลขที่บัญชี", get: (r) => r.bankAccount ?? "" },
  { key: "bankName", h: "ธนาคาร", get: (r) => r.bankName ?? "" },
  { key: "needByDate", h: "วันที่เริ่มใช้เงิน", get: (r) => d(r.needByDate) },
  { key: "expectedClearDate", h: "วันที่คาดเคลียร์", get: (r) => d(r.expectedClearDate), filter: "dates", rawDate: (r) => r.expectedClearDate },
  { key: "purpose", h: "รายละเอียด", get: (r) => r.purpose ?? "" },
  { key: "currency", h: "สกุลเงิน", get: (r) => r.currency ?? "" },
  { key: "amount", h: "จำนวนเงิน", get: (r) => n(r.amount), num: true },
  { key: "exchangeRate", h: "อัตราแลกเปลี่ยน", get: (r) => n(r.exchangeRate), num: true },
  { key: "baseAmount", h: "เบิก Advance (THB)", get: (r) => n(r.baseAmount), num: true },
  { key: "approvedName", h: "Approved Name", get: (r) => r.approvedName ?? "" },
  { key: "approvedDate", h: "Approved Date", get: (r) => dt(r.approvedDate) },
  { key: "approvedRemark", h: "Approved Remark", get: (r) => r.approvedRemark ?? "" },
  { key: "actionedByName", h: "Actioned By", get: (r) => r.actionedByName ?? "" },
  { key: "actionedDate", h: "Actioned Date", get: (r) => dt(r.actionedDate) },
  { key: "actionedRemark", h: "Actioned Remark", get: (r) => r.actionedRemark ?? "", filter: "text" },
  // A date filter, not a text one: payments land on the 2nd and 4th Friday, so
  // picking rounds is how accounting narrows a report to a payment week.
  { key: "paymentDate", h: "Payment Date", get: (r) => d(r.paymentDate), filter: "dates", rawDate: (r) => r.paymentDate },
  { key: "clearAdvanceNo", h: "Clear Advance no.", get: (r) => r.clearAdvanceNo ?? "", filter: "text" },
  { key: "advanceStatus", h: "Advance status", get: (r) => r.advanceStatus ?? "", filter: "text" },
  { key: "pendingOn", h: "Pending on", get: (r) => r.pendingOn ?? "" },
  { key: "overallStatus", h: "Overall Status", get: (r) => r.overallStatus, filter: "select" },
];

export default function AdvanceReportPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [overdueOnly, setOverdueOnly] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/report")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: Row[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  // distinct options for select filters
  const selectOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of COLS.filter((x) => x.filter === "select")) {
      map[c.key] = Array.from(new Set(rows.map((r) => c.get(r)).filter(Boolean))).sort();
    }
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayYmd();
    return rows.filter((r) => {
      if (overdueOnly && !isOverdueClearing(r, today)) return false;
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
        const v = c.get(r).toLowerCase();
        if (c.filter === "select") {
          // Multi-value, stored as CSV like the date filter: any selected value
          // matches, so a report can cover two statuses at once.
          const sel = f.split(",").filter(Boolean).map((s) => s.toLowerCase());
          if (sel.length && !sel.includes(v)) return false;
        }
        else if (!v.includes(f.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, search, filters, overdueOnly]);

  /** Standing count over the whole dataset, so the badge reads as a KPI rather
   *  than a reflection of whatever else is filtered right now. */
  const overdueCount = useMemo(() => {
    const today = todayYmd();
    return rows.filter((r) => isOverdueClearing(r, today)).length;
  }, [rows]);

  // Export เฉพาะข้อมูลที่กรองอยู่ (filtered) เป็น .xlsx
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

  const activeFilters = Object.values(filters).filter(Boolean).length + (search.trim() ? 1 : 0) + (overdueOnly ? 1 : 0);
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

      {/* ค้นหาเอกสาร + สถานะ filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1 min-w-[240px]"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <Search size={15} style={{ color: "var(--text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเอกสาร (เลขที่ Request / ชื่อ / รหัสพนักงาน)..."
            className="flex-1 text-[13px] outline-none bg-transparent" style={{ color: "var(--text-primary)" }} />
        </div>
        <button
          onClick={() => setOverdueOnly((v) => !v)}
          aria-pressed={overdueOnly}
          title="เบิกแล้วอนุมัติ แต่ยังไม่มีการเคลียร์ที่อนุมัติ และเลยวันที่คาดเคลียร์แล้ว"
          className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-xl cursor-pointer"
          style={overdueOnly
            ? { background: "var(--color-danger)", color: "#fff", border: "1px solid var(--color-danger)" }
            : { background: "var(--bg-card)", color: "var(--color-danger)", border: "1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)" }}>
          ค้างเคลียร์เกินกำหนด ({overdueCount})
        </button>
        {activeFilters > 0 && (
          <button onClick={() => { setSearch(""); setFilters({}); setOverdueOnly(false); }}
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
                <tr>{COLS.map((c) => <th key={c.key} style={th}>{c.h}</th>)}</tr>
                <tr>
                  {COLS.map((c) => (
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
                                  {new Date(dv).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" })}
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
                  <tr key={r.id} className="cursor-pointer hover:brightness-95"
                    onClick={() => router.push(`/request/advance/${r.id}`)} style={{ background: "var(--bg-card)" }}>
                    {COLS.map((c) => (
                      <td key={c.key} style={{ ...td, textAlign: c.num ? "right" : "left", fontWeight: c.key === "requestNo" ? 700 : 400 }} title={c.get(r)}>
                        {c.get(r)}
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
        {loading ? "" : `แสดง ${filtered.length} / ${rows.length} รายการ`} · คลิกแถวเพื่อเปิดคำขอ · ช่องกรองใต้หัวตาราง = คอลัมน์ที่ filter ได้ (ตาม AP-2-Control)
      </p>
    </PageContainer>
  );
}
