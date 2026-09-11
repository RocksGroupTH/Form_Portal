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
 *
 * **The sheet is A4 portrait on screen as well as on paper** — 210mm wide, laid
 * out against the 186mm that survives the 12mm print margins. A preview in a
 * width the printer will never use is not a preview: a table that fits at 900px
 * and spills at 186mm looks right until it comes out of the printer, and that is
 * the one moment nobody is watching.
 */
/**
 * The sheet's box lives here and **not** in an inline `style`, on purpose: an
 * inline declaration outranks any stylesheet rule, so a `padding: 0` in the
 * print block below would lose to it and the paper would come out with the
 * 12mm margin twice — plus a blank second page from a 297mm min-height inside a
 * 273mm printable area. Same specificity, later rule, print wins.
 */
const PRINT_CSS = `
#ap31-sheet {
  width: 210mm;
  min-height: 297mm;
  padding: 12mm;
  margin-inline: auto;
  background: #fff;
  color: #000;
  /* Screen only — what makes the preview read as a sheet of paper. */
  box-shadow: 0 1px 3px rgba(0,0,0,.18);
}
@media print {
  body * { visibility: hidden !important; }
  #ap31-sheet, #ap31-sheet * { visibility: visible !important; }
  #ap31-sheet {
    position: absolute; left: 0; top: 0; width: 100%;
    /* @page already pays the 12mm; the sheet's own padding would double it, and
       min-height would push a blank second page. */
    min-height: 0; margin: 0; padding: 0; border: none; box-shadow: none;
  }
  #ap31-sheet .ap31-sign { margin-top: 14mm; }
  .ap31-noprint { display: none !important; }
  html, body { background: #fff !important; }
  /* A logo is the one thing on this sheet that is not black on white. */
  #ap31-sheet img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* A long claim runs onto page 2: repeat the column heads, and never split a
     row down the middle of a page. */
  #ap31-sheet thead { display: table-header-group; }
  #ap31-sheet tfoot { display: table-row-group; }
  #ap31-sheet tr { break-inside: avoid; }
  #ap31-sheet .ap31-sign { break-inside: avoid; }
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
  const [brands, setBrands] = useState<{ id: string; logo: string | null }[]>([]);

  /**
   * The brand list, for the logo at the top of the sheet.
   *
   * `/api/brands` and not the `/brandlogo/{code}-200.png` convention alone,
   * because a brand whose logo was uploaded through Brand configuration has no
   * file on disk — the convention would silently print no mark for exactly the
   * brands someone took the trouble to give artwork to. It does not depend on
   * the request, so it loads alongside it rather than after it, and a failure
   * is not an error: the sheet prints without a logo.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/brands")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { id: string; logo: string | null }[] }) => {
        if (!cancelled && json.ok && json.data) setBrands(json.data);
      })
      .catch(() => { /* no logo, still a valid sheet */ });
    return () => { cancelled = true; };
  }, []);

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

  // The brand the money was drawn against, not whichever one the switcher is on:
  // a printed sheet is evidence, and it has to name its own request's brand.
  const brandCode = (request.brandCode ?? "").trim();
  const brandLogo = brandCode
    ? brands.find((b) => b.id.trim().toUpperCase() === brandCode.toUpperCase())?.logo
        ?? `/brandlogo/${brandCode.toLowerCase()}-200.png`
    : null;
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

      <div id="ap31-sheet" className="text-[11px]" style={{ fontFamily: "inherit" }}>
        <header className="mb-5 flex items-center gap-3">
          <PrintLogo src={brandLogo} alt={request.companyName ?? brandCode} />
          <div>
            <h1 className="text-[17px] font-bold m-0">แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (AP-3.1)</h1>
            <p className="text-[12px] m-0 mt-1">เลขที่คำขอ {request.requestNo ?? "ฉบับร่าง"}</p>
          </div>
        </header>

        <table className="w-full mb-5" style={{ borderCollapse: "collapse" }}>
          <tbody>
            <HeaderRow label="เลขที่เงินทดรองจ่าย (ADV)" value={clear?.advanceRequestNo ?? "—"}
              label2="วงเงินที่ได้รับ" value2={`${money(advanceAmount)} ${clear?.currency ?? "THB"}`} />
            {/* The employee code sits beside the name it belongs to, as its own
                labelled field rather than in a parenthesis — this sheet is
                stapled to the receipts and read by someone matching it against
                a payroll record, and a bare number after a name reads as part
                of the name. It is `StaffId`, the same number the control
                report's รหัสพนักงาน column carries. */}
            <HeaderRow label="ผู้ขอเคลียร์" value={request.requesterFullName ?? "—"}
              label2="รหัสพนักงาน" value2={request.staffId != null ? String(request.staffId) : "—"} />
            <HeaderRow label="ตำแหน่ง" value={request.requesterPosition ?? "—"}
              label2="แผนก" value2={request.requesterDepartmentName ?? "—"} />
            {/* The company takes the whole width. It is the one value here
                with no natural ceiling — a registered name plus its
                (สำนักงานใหญ่) suffix — and at half a row it wrapped on the
                shortest of the group's names by a single pixel. Widening the
                column only moves where that happens. */}
            <HeaderRow label="บริษัท" value={request.companyName ?? "—"} wide />
            <HeaderRow label="วันที่ยื่นคำขอ" value={fmtDateOnly(request.submittedAt ?? request.createdAt)}
              label2="วันที่พิมพ์" value2={fmtDateOnly(new Date().toISOString().slice(0, 10))} />
          </tbody>
        </table>

        <table className="w-full mb-4" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
          {/*
            Fixed columns, because 186mm is not enough for ten columns to size
            themselves: left to `auto`, one long รายการ pushes the five money
            columns until the amounts wrap mid-number. The description is the
            column that gives — it is the only one that can wrap and still be
            read.
          */}
          {/*
            Every column is sized by the widest thing it must hold, measured at
            186mm — the A4 width the @page margins leave — not by an even share.
            รายการ is the only one meant to wrap; a number or a code broken
            across two lines on a sheet somebody signs reads as two values.

              #              22.5px — two digits and the heading
              วันที่          74.5 — "10/08/2026" needs 68.3 with padding
              เลขที่เอกสาร    107  — fifteen characters, "INV202608120001"
              รายการ         127  — wraps, four or five words a line
              สาขา            49  — a five-character BC branch code
              ก่อน VAT/รวม/สุทธิ  67 each — "999,999.00"
              VAT / WHT       61 each — "99,999.00"

            VAT and WHT are narrower on purpose: they are a fraction of the
            figure beside them, and 7% of a ฿999,999 line is ฿70,000, which
            fits. The width they give up is what buys เลขที่เอกสาร its fifteenth
            character — it was 11% and cut "INV202608120001" in half.

            Beyond those ceilings a value wraps again, and that is accepted: the
            next digit or character costs รายการ, which every sheet uses.
          */}
          <colgroup>
            <col style={{ width: "3.2%" }} />
            <col style={{ width: "10.6%" }} />
            <col style={{ width: "15.2%" }} />
            <col style={{ width: "18.1%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "9.5%" }} />
            <col style={{ width: "8.7%" }} />
            <col style={{ width: "9.5%" }} />
            <col style={{ width: "8.7%" }} />
            <col style={{ width: "9.5%" }} />
          </colgroup>
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
                <Td nowrap>{fmtDateOnly(it.expenseDate)}</Td>
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
        <div className="ap31-sign flex justify-end">
          <div className="text-center" style={{ width: "70mm" }}>
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

/**
 * The brand mark on the sheet, or nothing at all.
 *
 * Not `BrandMark`: its fallback is a coloured chip drawn from the dashboard's
 * theme variables, which is right in the navbar and wrong on a black-on-white
 * form — a brand with no artwork should leave the header alone rather than
 * print a coloured box. A missing file is normal (the `-200.png` convention is
 * never checked for existence), so `onError` is the fallback path, the same way
 * every other logo in the app handles it.
 */
function PrintLogo({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="object-contain shrink-0"
      style={{ height: 44, width: "auto", maxWidth: 160 }}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

const cell = { border: "1px solid #000", padding: "3px 5px", verticalAlign: "top" } as const;

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ ...cell, textAlign: right ? "right" : "left" }}>{children}</th>;
}

/**
 * `right` means "this is money": it also stops the number wrapping and lines the
 * digits up in their column. Text wraps instead of widening the table, which is
 * what keeps ten columns inside 186mm.
 */
function Td({ children, right, nowrap, colSpan }: {
  children: React.ReactNode; right?: boolean; nowrap?: boolean; colSpan?: number;
}) {
  const keepWhole = right || nowrap;
  return (
    <td
      colSpan={colSpan}
      style={{
        ...cell,
        textAlign: right ? "right" : "left",
        whiteSpace: keepWhole ? "nowrap" : "normal",
        fontVariantNumeric: right ? "tabular-nums" : undefined,
        overflowWrap: keepWhole ? "normal" : "anywhere",
      }}
    >
      {children}
    </td>
  );
}

/** A row of the header block: one labelled field, or two side by side. The
 *  second is optional because the fields are an odd number, and an empty pair
 *  keeps the column widths of the rows above it. */
/**
 * A row of the header block: one labelled field, or two side by side. The
 * second is optional because the fields are an odd number, and an empty pair
 * keeps the column widths of the rows above it.
 *
 * The widths are measured, not guessed. At 186mm — the A4 width the @page
 * margins leave — the four columns were 23/27/18/32, which gave the first
 * value 165.8px of text while "บริษัท ร็อคส์ พีซี จำกัด (สำนักงานใหญ่)" needs
 * 166.8: the company name wrapped, by one pixel, on every sheet. The last
 * column meanwhile had 101px it never used, the longest thing in it being a
 * department name at 124.
 *
 * So the slack moves to where the long values are. The first value now has
 * 215px — about eleven Thai characters past the longest company name in use —
 * and every label still fits on one line, the longest being
 * "เลขที่เงินทดรองจ่าย (ADV)" at 121.3px against 132.6 available.
 */
function HeaderRow({ label, value, label2, value2, wide }: {
  label: string; value: string; label2?: string; value2?: string;
  /** One value across the rest of the row, for a value with no ceiling. */
  wide?: boolean;
}) {
  return (
    <tr>
      <td className="text-[11px] font-semibold py-1 pr-2" style={{ width: "20%" }}>{label}</td>
      {wide ? (
        <td className="text-[11px] py-1" colSpan={3}>{value}</td>
      ) : (
        <>
          <td className="text-[11px] py-1 pr-6" style={{ width: "34%" }}>{value}</td>
          <td className="text-[11px] font-semibold py-1 pr-2" style={{ width: "15%" }}>{label2 ?? ""}</td>
          <td className="text-[11px] py-1">{value2 ?? ""}</td>
        </>
      )}
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
