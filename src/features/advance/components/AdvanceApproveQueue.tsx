"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Eye, ClipboardCheck, Search } from "lucide-react";
import { PaymentDatePicker } from "@/components/ui/PaymentDatePicker";
import { AdvanceCompanyBar, ADVANCE_COMPANY_ALL } from "./AdvanceCompanyBar";
import { AdvanceDetailPanel } from "./AdvanceDetailPanel";
import { money, rate } from "./CurrencyColumns";
import { AP2_DEFAULT_CURRENCY, isForeignCurrency } from "@/features/advance/constants";
import { buildBulkMessage, type BulkItemResult } from "@/features/advance/lib/bulk-result-message";
import { AdvanceQueueVendorCell } from "./AdvanceQueueVendorCell";
import { QueueColumnFilter } from "./QueueColumnFilter";
import { ColumnToggleMenu } from "@/features/travel-booking/components/ColumnToggleMenu";
import { APPROVE_QUEUE_COLUMNS, APPROVE_QUEUE_PREFS } from "@/features/advance/lib/approve-queue-columns";

interface QueueRow {
  id: number;
  requestNo: string | null;
  brandCode: string | null;
  interfaceTarget: string;
  requesterFullName: string | null;
  payeeName: string | null;
  currency: string | null;
  amount: number | null;
  exchangeRate: number | null;
  baseAmount: number | null;
  stepLabel: string;
  needsPayment: boolean;
  matchedVendorNo: string | null;
  matchedVendorName: string | null;
  vendorMatchStatus: string | null;
  vendorMatchReason?: string | null;
}

export function AdvanceApproveQueue() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [company, setCompany] = useState<string>(ADVANCE_COMPANY_ALL);
  const [busy, setBusy] = useState(false);
  const [panelId, setPanelId] = useState<number | null>(null);

  const [paymentDates, setPaymentDates] = useState<string[]>([]);
  const [paymentDate, setPaymentDate] = useState<string>("");
  const [checked, setChecked] = useState(false);

  // Column layout and filters — the reader's own, remembered per browser.
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>(APPROVE_QUEUE_PREFS.defaultVisible);
  const [order, setOrder] = useState<string[]>(() => APPROVE_QUEUE_COLUMNS.map((c) => c.key));

  // Read the stored layout after mount: localStorage is not available during
  // SSR, and seeding state from it directly would hydrate a different table
  // than the server rendered.
  useEffect(() => {
    setVisible(APPROVE_QUEUE_PREFS.loadVisibility());
    setOrder(APPROVE_QUEUE_PREFS.loadOrder());
  }, []);

  const handleVisibleChange = useCallback((next: Record<string, boolean>) => {
    setVisible(next);
    APPROVE_QUEUE_PREFS.saveVisibility(next);
  }, []);

  const handleReorder = useCallback((keys: string[]) => {
    const next = APPROVE_QUEUE_PREFS.mergeOrder(keys);
    setOrder(next);
    APPROVE_QUEUE_PREFS.saveOrder(next);
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/approvals/queue")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: QueueRow[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    fetch("/api/request/advance/payment-dates")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { dates: string[]; default: string } }) => {
        if (j.ok && j.data) { setPaymentDates(j.data.dates); setPaymentDate(j.data.default); }
      })
      .catch(() => {});
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.interfaceTarget] = (c[r.interfaceTarget] ?? 0) + 1;
    return c;
  }, [rows]);

  /** Plain text per column — the one place a column's value is defined for
   *  filtering and for the free-text search, so the two can never disagree. */
  const cellText = useCallback((r: QueueRow, key: string): string => {
    switch (key) {
      case "requestNo": return r.requestNo ?? `#${r.id}`;
      case "company": return r.interfaceTarget || "";
      case "requester": return r.requesterFullName ?? "";
      case "payee": return r.payeeName ?? "";
      case "currency": return r.currency ?? AP2_DEFAULT_CURRENCY;
      case "amount": return r.amount == null ? "" : String(r.amount);
      case "exchangeRate": return r.exchangeRate == null ? "" : String(r.exchangeRate);
      case "baseAmount": return String(r.baseAmount ?? 0);
      case "vendor": return `${r.matchedVendorNo ?? ""} ${r.matchedVendorName ?? ""}`.trim();
      case "step": return r.stepLabel ?? "";
      default: return "";
    }
  }, []);

  const companyFiltered = useMemo(
    () => (company === ADVANCE_COMPANY_ALL ? rows : rows.filter((r) => r.interfaceTarget === company)),
    [rows, company],
  );

  /** Options for the select filters, taken from what is actually in the queue. */
  const selectOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of APPROVE_QUEUE_COLUMNS) {
      if (c.filter !== "select") continue;
      map[c.key] = Array.from(new Set(companyFiltered.map((r) => cellText(r, c.key)).filter(Boolean))).sort();
    }
    return map;
  }, [companyFiltered, cellText]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companyFiltered.filter((r) => {
      if (q && !APPROVE_QUEUE_COLUMNS.some((c) => cellText(r, c.key).toLowerCase().includes(q))) return false;
      for (const c of APPROVE_QUEUE_COLUMNS) {
        const f = filters[c.key];
        if (!f) continue;
        const v = cellText(r, c.key).toLowerCase();
        if (c.filter === "select") {
          // CSV of picks: any one matching keeps the row, so a queue can show
          // two companies or two steps at once.
          const sel = f.split(",").filter(Boolean).map((s) => s.toLowerCase());
          if (sel.length && !sel.includes(v)) return false;
        } else if (!v.includes(f.toLowerCase())) return false;
      }
      return true;
    });
  }, [companyFiltered, filters, search, cellText]);

  // Selection is scoped to the visible (filtered) rows.
  const selectedRows = useMemo(() => filtered.filter((r) => selected.has(r.id)), [filtered, selected]);
  const needsPaymentSelected = selectedRows.some((r) => r.needsPayment);
  const anyNeedsVendor = useMemo(() => filtered.some((r) => r.needsPayment), [filtered]);

  /** The columns to draw, in the reader's order, minus the hidden ones — and
   *  minus Vendor unless the queue is actually showing payment-step rows. */
  const shownColumns = useMemo(() => {
    const byKey = new Map(APPROVE_QUEUE_COLUMNS.map((c) => [c.key, c]));
    return order
      .map((k) => byKey.get(k))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .filter((c) => (visible[c.key] ?? true) && (c.key !== "vendor" || anyNeedsVendor));
  }, [order, visible, anyNeedsVendor]);

  const anyFilterOn = Object.keys(filters).length > 0 || search.trim().length > 0;

  /** Cell content by key. Most columns are the text from `cellText`; the few
   *  that carry a control or a chip render it here. */
  function renderCell(r: QueueRow, key: string): React.ReactNode {
    switch (key) {
      case "requestNo":
        return <span className="font-bold">{r.requestNo ?? `#${r.id}`}</span>;
      case "currency":
        return (
          <span className="font-mono text-[11px]"
            style={{ color: isForeignCurrency(r.currency) ? "var(--nav-active-text)" : "var(--text-muted)" }}>
            {r.currency ?? AP2_DEFAULT_CURRENCY}
          </span>
        );
      case "amount":
        return isForeignCurrency(r.currency) && r.amount != null
          ? money(r.amount)
          : <span style={{ color: "var(--text-faint)" }}>—</span>;
      case "exchangeRate":
        return isForeignCurrency(r.currency) && r.exchangeRate != null
          ? rate(r.exchangeRate)
          : <span style={{ color: "var(--text-faint)" }}>—</span>;
      case "baseAmount":
        return <span className="font-semibold">{money(r.baseAmount ?? 0)}</span>;
      case "vendor":
        return r.needsPayment ? (
          <AdvanceQueueVendorCell
            requestId={r.id}
            brandCode={r.brandCode}
            vendorNo={r.matchedVendorNo}
            vendorName={r.matchedVendorName}
            status={r.vendorMatchStatus}
            reason={r.vendorMatchReason}
            onConfirmed={load}
          />
        ) : (
          <span style={{ color: "var(--text-faint)" }}>—</span>
        );
      case "step":
        return (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
            {r.stepLabel}
          </span>
        );
      default:
        return cellText(r, key) || "-";
    }
  }
  // Selected rows the ACC_OFFICER gate will refuse — told up front, since the
  // fix is right there in the Vendor column.
  const unconfirmed = useMemo(
    () => selectedRows.filter((r) => r.needsPayment && r.vendorMatchStatus !== "confirmed"),
    [selectedRows],
  );
  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function bulkApprove() {
    if (selectedRows.length === 0) return toast.error("ยังไม่ได้เลือกรายการ");
    if (needsPaymentSelected) {
      if (!checked) return toast.error("มีรายการขั้นจ่ายเงิน — ต้องกด \"ตรวจสอบแล้ว\" ก่อน");
      if (!paymentDate) return toast.error("มีรายการขั้นจ่ายเงิน — กรุณาเลือกวันจ่าย");
    }
    setBusy(true);
    try {
      const res = await fetch("/api/request/advance/approvals/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedRows.map((r) => r.id),
          paymentDate: needsPaymentSelected ? paymentDate : undefined,
          isChecked: needsPaymentSelected ? checked : undefined,
        }),
      });
      const j = (await res.json()) as
        { ok: boolean; okCount?: number; error?: string; results?: BulkItemResult[] };
      if (j.error && !j.okCount) throw new Error(j.error);
      // The endpoint refuses individual requests with a reason the officer can
      // act on — most often an unconfirmed Vendor — so show it instead of a
      // bare count.
      const byId = new Map(rows.map((r) => [r.id, r.requestNo ?? `#${r.id}`]));
      const m = buildBulkMessage("อนุมัติ", j.results ?? [], j.okCount, (id) => byId.get(id) ?? `#${id}`);
      if (m.kind === "success") toast.success(m.title);
      else toast.error(m.title, { description: m.description, duration: 8000 });
      setSelected(new Set());
      setChecked(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อนุมัติไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <AdvanceCompanyBar value={company} onChange={setCompany} counts={counts} />

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาทุกคอลัมน์"
              className="text-[12px] rounded-lg pl-7 pr-3 py-2 outline-none w-[220px]"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-input)", color: "var(--text-primary)" }} />
          </div>
          {anyFilterOn && (
            <button type="button" onClick={() => { setFilters({}); setSearch(""); }}
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer border-none"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
              ล้างตัวกรอง
            </button>
          )}
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {filtered.length} / {companyFiltered.length} รายการ
          </span>
          <div className="ml-auto">
            <ColumnToggleMenu
              columns={APPROVE_QUEUE_COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
              visible={visible}
              onChange={handleVisibleChange}
              onReorder={handleReorder}
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
          {/* An empty queue and an over-filtered one are different problems, and
              telling a reader there is nothing to approve while their own filter
              is hiding it would send them looking in the wrong place. */}
          {anyFilterOn
            ? "ไม่มีรายการตามตัวกรอง — ลองล้างตัวกรอง"
            : `ไม่มีรายการรอคุณอนุมัติ${company !== ADVANCE_COMPANY_ALL ? " ในบริษัทนี้" : ""}`}
        </p>
      ) : (
        <>
          {/* bulk action bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
            <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
              เลือกแล้ว {selectedRows.length} รายการ
            </span>
            {needsPaymentSelected && (
              <>
                <div className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                  วันจ่าย:
                  <PaymentDatePicker value={paymentDate} onChange={setPaymentDate} allowedDates={paymentDates} />
                </div>
                <label className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  ตรวจสอบแล้ว
                </label>
              </>
            )}
            {unconfirmed.length > 0 && (
              <span className="text-[11px] font-semibold px-2 py-1 rounded-lg"
                style={{
                  background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)",
                  border: "1px solid var(--border-info-yellow)",
                }}
                title={unconfirmed.map((r) => r.requestNo ?? `#${r.id}`).join(", ")}>
                ⚠️ {unconfirmed.length} รายการยังไม่ยืนยัน Vendor — ยืนยันในคอลัมน์ Vendor ก่อน
              </span>
            )}
            <div className="ml-auto">
              <Button variant="primary" icon={<ClipboardCheck size={15} />}
                onClick={bulkApprove} loading={busy} disabled={selectedRows.length === 0}>
                อนุมัติที่เลือก
              </Button>
            </div>
          </div>

          {/* table */}
          {/* show-x-scroll: `.acc-theme *` hides every scrollbar, so a table that
              scrolls sideways had no affordance saying so — the columns past the
              edge just looked cut off. This class opts the bar back in. */}
          <div className="overflow-x-auto show-x-scroll">
            {/* Sizes to content so the wrapper scrolls instead of the table
                squeezing a name column into three lines — same reason as
                AdvanceErpQueue. */}
            <table className="w-max min-w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-card)" }}>
                  <th className="p-2 text-left w-8">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  </th>
                  {shownColumns.map((c) => (
                    <th key={c.key} className={`p-2 whitespace-nowrap ${c.numeric ? "text-right" : "text-left"}`}>
                      {c.label}
                    </th>
                  ))}
                  <th className="p-2 text-center w-10"></th>
                </tr>
                {/* Filter row — one cell per shown column, so it follows the
                    reader's order and disappears with a hidden column. */}
                <tr style={{ borderBottom: "1px solid var(--border-card)" }}>
                  <td className="p-1" />
                  {shownColumns.map((c) => (
                    <td key={c.key} className="p-1 align-top">
                      {c.filter ? (
                        <QueueColumnFilter
                          kind={c.filter}
                          value={filters[c.key] ?? ""}
                          options={selectOptions[c.key]}
                          onChange={(v) => setFilter(c.key, v)}
                        />
                      ) : null}
                    </td>
                  ))}
                  <td className="p-1" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border-card)", color: "var(--text-primary)" }}>
                    <td className="p-2">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    {shownColumns.map((c) => (
                      <td key={c.key}
                        className={`p-2 ${c.numeric ? "text-right tabular-nums whitespace-nowrap" : ""} ${c.key === "requester" || c.key === "payee" ? "whitespace-nowrap" : ""}`}>
                        {renderCell(r, c.key)}
                      </td>
                    ))}
                    <td className="p-2 text-center">
                      <button type="button" onClick={() => setPanelId(r.id)}
                        className="cursor-pointer" title="ดูเอกสาร" style={{ color: "var(--text-muted)" }}>
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AdvanceDetailPanel requestId={panelId} onClose={() => setPanelId(null)} onChanged={load} />
    </div>
  );
}
