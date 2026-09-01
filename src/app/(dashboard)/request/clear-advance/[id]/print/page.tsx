"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Printer } from "lucide-react";
import type { ClearAdvanceItem, ClearAdvanceRequest } from "@/features/clear-advance/types";

/**
 * AP-3.1 on paper — the sheet the employee signs and staples in front of the
 * receipts.
 *
 * Printing is the browser's own dialog and nothing else: no PDF library, no new
 * dependency. The route sits inside `(dashboard)` so it inherits `RouteGuard`
 * and the same `/api/request/clear-advance/requests/{id}` load the detail screen
 * uses — a print view must never become a second, unguarded way to read a
 * request.
 */

/**
 * The dashboard shell wraps this page, so the print rules hide *everything* and
 * then un-hide the sheet, rather than trying to name each piece of chrome. The
 * sheet itself is black-on-white on screen too: what you see is the paper.
 */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #ap31-sheet, #ap31-sheet * { visibility: visible !important; }
  #ap31-sheet {
    position: absolute; left: 0; top: 0; width: 100%;
    margin: 0; padding: 0; border: none; box-shadow: none;
  }
  .ap31-noprint { display: none !important; }
  html, body { background: #fff !important; }
  @page { size: A4 portrait; margin: 12mm; }
}
`;

function money(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Date-only display; expense dates arrive as YYYY-MM-DD. Local getters only. */
function fmtDateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export default function ClearAdvancePrintPage() {
  return (
    <Suspense fallback={null}>
      <PrintContent />
    </Suspense>
  );
}

function PrintContent() {
  const params = useParams();
  const requestId = params?.id ? Number(String(params.id)) : null;

  const [request, setRequest] = useState<ClearAdvanceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (requestId == null || Number.isNaN(requestId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/request/clear-advance/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ClearAdvanceRequest }) => {
        if (cancelled) return;
        if (json.ok && json.data) setRequest(json.data);
        else setNotFound(true);
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId]);

  if (loading) return <p className="p-6 text-[13px]">กำลังโหลด...</p>;
  if (notFound || !request) return <p className="p-6 text-[13px]">ไม่พบคำขอ</p>;

  const clear = request.clear;
  const items: ClearAdvanceItem[] = clear?.items ?? [];
  const advanceAmount = clear?.advanceAmount ?? 0;
  const refund = clear?.refundToCompany ?? 0;

  const totals = { before: 0, vat: 0, total: 0, wht: 0, net: 0 };
  const rows = items.map((it, i) => {
    const before = it.amountBeforeVat ?? 0;
    const vat = it.vatAmount ?? 0;
    const total = it.totalInclVat ?? before + vat;
    const wht = it.whtAmount ?? 0;
    const net = it.netAmount ?? total - wht;
    totals.before += before; totals.vat += vat; totals.total += total; totals.wht += wht; totals.net += net;
    return { it, before, vat, total, wht, net, i };
  });

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="ap31-noprint flex justify-end p-4">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer border-none"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          <Printer size={14} /> พิมพ์
        </button>
      </div>

      <div
        id="ap31-sheet"
        className="mx-auto p-8 text-[12px]"
        style={{ maxWidth: 900, background: "#fff", color: "#000", fontFamily: "inherit" }}
      >
        <header className="mb-5">
          <h1 className="text-[17px] font-bold m-0">แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (AP-3.1)</h1>
          <p className="text-[12px] m-0 mt-1">เลขที่คำขอ {request.requestNo ?? "ฉบับร่าง"}</p>
        </header>

        <table className="w-full mb-5" style={{ borderCollapse: "collapse" }}>
          <tbody>
            <HeaderRow label="เลขที่เงินทดรองจ่าย (ADV)" value={clear?.advanceRequestNo ?? "—"}
              label2="วงเงินที่ได้รับ" value2={`${money(advanceAmount)} ${clear?.currency ?? "THB"}`} />
            <HeaderRow label="ผู้ขอเคลียร์" value={request.requesterFullName ?? "—"}
              label2="ตำแหน่ง" value2={request.requesterPosition ?? "—"} />
            <HeaderRow label="แผนก" value={request.requesterDepartmentName ?? "—"}
              label2="บริษัท" value2={request.companyName ?? "—"} />
            <HeaderRow label="วันที่ยื่นคำขอ" value={fmtDateOnly(request.submittedAt ?? request.createdAt)}
              label2="วันที่พิมพ์" value2={fmtDateOnly(new Date().toISOString().slice(0, 10))} />
          </tbody>
        </table>

        <table className="w-full mb-4" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-[11px] font-bold">
              <Th>#</Th><Th>วันที่</Th><Th>เลขที่เอกสาร</Th><Th>รายการ</Th><Th>สาขา</Th>
              <Th right>ก่อน VAT</Th><Th right>VAT</Th><Th right>รวม</Th><Th right>WHT</Th><Th right>สุทธิ</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={10}>— ไม่มีรายการค่าใช้จ่าย</Td></tr>
            )}
            {rows.map(({ it, before, vat, total, wht, net, i }) => (
              <tr key={it.id ?? i}>
                <Td>{i + 1}</Td>
                <Td>{fmtDateOnly(it.expenseDate)}</Td>
                <Td>{it.docNo ?? "—"}</Td>
                <Td>{[it.glAccountNo, it.glAccountName, it.description].filter(Boolean).join(" · ") || "—"}</Td>
                <Td>{it.branchCode ?? "—"}</Td>
                <Td right>{money(before)}</Td>
                <Td right>{money(vat)}</Td>
                <Td right>{money(total)}</Td>
                <Td right>{money(wht)}</Td>
                <Td right>{money(net)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <Td colSpan={5}>รวมทั้งหมด</Td>
              <Td right>{money(totals.before)}</Td>
              <Td right>{money(totals.vat)}</Td>
              <Td right>{money(totals.total)}</Td>
              <Td right>{money(totals.wht)}</Td>
              <Td right>{money(totals.net)}</Td>
            </tr>
          </tfoot>
        </table>

        <table className="mb-8 ml-auto" style={{ borderCollapse: "collapse" }}>
          <tbody>
            <SummaryRow label="วงเงินที่ได้รับ" value={money(advanceAmount)} />
            <SummaryRow label="ค่าใช้จ่ายจริง" value={money(clear?.actualTotal ?? totals.net)} />
            <SummaryRow
              label={refund < 0 ? "บริษัทต้องจ่ายเพิ่ม" : "ต้องโอนคืนบริษัท"}
              value={money(Math.abs(refund))}
              strong
            />
          </tbody>
        </table>

        {/* The point of the printed sheet: a wet signature to staple to the receipts. */}
        <div className="flex justify-end">
          <div className="text-center" style={{ width: 280 }}>
            <div style={{ borderBottom: "1px solid #000", height: 56 }} />
            <p className="text-[12px] m-0 mt-1.5">( {request.requesterFullName ?? ""} )</p>
            <p className="text-[11px] m-0 mt-0.5">ผู้เคลียร์เงินทดรองจ่าย</p>
            <p className="text-[11px] m-0 mt-2">วันที่ ............ / ............ / ............</p>
          </div>
        </div>
      </div>
    </>
  );
}

const cell = { border: "1px solid #000", padding: "4px 6px" } as const;

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ ...cell, textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>{children}</th>;
}

function Td({ children, right, colSpan }: { children: React.ReactNode; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} style={{ ...cell, textAlign: right ? "right" : "left" }}>{children}</td>;
}

function HeaderRow({ label, value, label2, value2 }: { label: string; value: string; label2: string; value2: string }) {
  return (
    <tr>
      <td className="text-[11px] font-semibold py-1 pr-2" style={{ width: "18%" }}>{label}</td>
      <td className="text-[12px] py-1 pr-6" style={{ width: "32%" }}>{value}</td>
      <td className="text-[11px] font-semibold py-1 pr-2" style={{ width: "18%" }}>{label2}</td>
      <td className="text-[12px] py-1">{value2}</td>
    </tr>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? "font-bold" : undefined}>
      <td className="text-[12px] py-1 pr-6">{label}</td>
      <td className="text-[12px] py-1 text-right tabular-nums" style={{ minWidth: 120 }}>{value}</td>
    </tr>
  );
}
