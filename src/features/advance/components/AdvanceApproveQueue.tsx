"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Eye, ClipboardCheck } from "lucide-react";
import { PaymentDatePicker } from "@/components/ui/PaymentDatePicker";
import { AdvanceCompanyBar, ADVANCE_COMPANY_ALL } from "./AdvanceCompanyBar";
import { AdvanceDetailPanel } from "./AdvanceDetailPanel";
import { CurrencyCells, CURRENCY_HEADERS } from "./CurrencyColumns";
import { buildBulkMessage, type BulkItemResult } from "@/features/advance/lib/bulk-result-message";

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

  const filtered = useMemo(
    () => (company === ADVANCE_COMPANY_ALL ? rows : rows.filter((r) => r.interfaceTarget === company)),
    [rows, company],
  );

  // Selection is scoped to the visible (filtered) rows.
  const selectedRows = useMemo(() => filtered.filter((r) => selected.has(r.id)), [filtered, selected]);
  const needsPaymentSelected = selectedRows.some((r) => r.needsPayment);
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

      {filtered.length === 0 ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
          ไม่มีรายการรอคุณอนุมัติ{company !== ADVANCE_COMPANY_ALL ? " ในบริษัทนี้" : ""}
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
            <div className="ml-auto">
              <Button variant="primary" icon={<ClipboardCheck size={15} />}
                onClick={bulkApprove} loading={busy} disabled={selectedRows.length === 0}>
                อนุมัติที่เลือก
              </Button>
            </div>
          </div>

          {/* table */}
          <div className="overflow-x-auto">
            {/* Sizes to content so the wrapper scrolls instead of the table
                squeezing a name column into three lines — same reason as
                AdvanceErpQueue. */}
            <table className="w-max min-w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-card)" }}>
                  <th className="p-2 text-left w-8">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  </th>
                  <th className="p-2 text-left">เลขที่</th>
                  <th className="p-2 text-left">Company</th>
                  <th className="p-2 text-left">ผู้ขอ</th>
                  <th className="p-2 text-left">ผู้รับเงิน</th>
                  {CURRENCY_HEADERS.map((h, i) => (
                    <th key={h} className={i === 0 ? "p-2 text-left" : "p-2 text-right"}>{h}</th>
                  ))}
                  <th className="p-2 text-left">ขั้น</th>
                  <th className="p-2 text-center w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border-card)", color: "var(--text-primary)" }}>
                    <td className="p-2">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="p-2 font-bold">{r.requestNo ?? `#${r.id}`}</td>
                    <td className="p-2">{r.interfaceTarget || "-"}</td>
                    <td className="p-2 whitespace-nowrap">{r.requesterFullName ?? "-"}</td>
                    <td className="p-2 whitespace-nowrap">{r.payeeName ?? "-"}</td>
                    <CurrencyCells row={r} cellClass="p-2" />
                    <td className="p-2">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                        {r.stepLabel}
                      </span>
                    </td>
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
