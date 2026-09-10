"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ClearAdvanceItem } from "@/features/clear-advance/types";
import { vendorMatches } from "@/lib/clr/tax-vendor-core";
import { PickerPanel, useAnchoredPopup } from "@/features/clear-advance/components/LinePickers";
import type { TaxVendorCandidate } from "@/features/clear-advance/hooks/useTaxVendors";

/**
 * The "Vendor" cell — the BC vendor card this expense line's seller maps to.
 *
 * It used to be a panel in a card below the table, one card per line, tied to
 * its row by nothing but the ordinal printed on it. On the row, the seller name
 * and tax id it has to agree with are the two cells to its left.
 *
 * 1,604 cards is small enough to send once and filter here, so there is no
 * query to run — and the filtering stays in the browser because the same match
 * in SQL went through Thai_CI_AS, where a consonant and the mark above it are
 * one collation element, so '%พิษณุพจน%' did not match "พิษณุพจน์".
 */
export function VendorCell({
  item,
  vendors,
  list,
  onLoad,
  onPick,
}: {
  item: Pick<ClearAdvanceItem, "taxId" | "payeeName" | "vatAmount" | "taxVendorNo">;
  vendors: TaxVendorCandidate[] | "loading" | "failed" | null;
  list: TaxVendorCandidate[];
  onLoad: () => void;
  onPick: (vendorNo: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  /* The grid's own picker machinery, not a second implementation of it: the
     panel portals to <body> in viewport coords so the table's overflow
     container cannot clip it, closes on outside mousedown and on Escape, and
     follows any scroll container. A hand-rolled `absolute` panel inside the
     scroll wrapper is clipped on the last row and near the right edge — which
     is exactly why this exists. */
  const { btnRef, popRef, pos } = useAnchoredPopup(open, setOpen, false);

  const tin = (item.taxId ?? "").replace(/\D/g, "");
  const hasTin = tin.length === 13;
  const vat = Number(item.vatAmount ?? 0);
  const chosenNo = (item.taxVendorNo ?? "").trim();
  const chosen = list.find((c) => c.vendorNo === chosenNo) ?? null;
  const invoiceName = (item.payeeName ?? "").trim();

  /* The cards whose tax id is the one on this receipt, first and marked. Every
     other card is still one keystroke away — the tax id is a strong hint, not a
     filter, because the seller may simply have no tax id on their card. */
  const shortlist = useMemo(() => {
    const matching = list.filter((c) => vendorMatches(c, term));
    if (!hasTin) return matching.slice(0, 80);
    const exact: TaxVendorCandidate[] = [];
    const rest: TaxVendorCandidate[] = [];
    for (const c of matching) {
      ((c.taxRegistrationNumber ?? "").replace(/\D/g, "") === tin ? exact : rest).push(c);
    }
    return [...exact, ...rest].slice(0, 80);
  }, [list, term, hasTin, tin]);

  return (
    <div className="relative flex flex-col gap-0.5" style={{ minWidth: 190 }}>
      <button
        ref={btnRef}
        type="button"
        title={vat > 0 ? "ต้องระบุ — ใช้เป็น Tax Vendor No. บนบรรทัด VAT" : "ไม่บังคับ — บรรทัดนี้ไม่มี VAT"}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (!next) return;
          if (vendors === null || vendors === "failed") onLoad();
          /* Seeded with the seller off the receipt, so the common case is
             open-and-pick rather than open-and-type. Not when one is already
             chosen: an open then is a change of mind, and the receipt's name is
             what it was changed away from. */
          if (!chosenNo && !term) setTerm(invoiceName);
        }}
        className="text-[12px] px-2 py-1 rounded w-full text-left flex items-center gap-1.5 cursor-pointer"
        style={{
          background: "var(--bg-input)",
          color: chosenNo ? "var(--text-primary)" : "var(--text-faint)",
          border: `1px solid ${!chosenNo && vat > 0 ? "var(--color-danger)" : "var(--border-input)"}`,
        }}
      >
        <span className="flex-1 min-w-0 truncate">
          {chosenNo
            ? `${chosenNo}${chosen?.displayName ? ` · ${chosen.displayName}` : ""}`
            : vat > 0
              ? "— ต้องเลือก —"
              : "— เลือก (เว้นว่างได้) —"}
        </span>
        <Search size={11} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      </button>

      {open && (
        <PickerPanel inline={false} pos={pos} panelRef={popRef}>
          <div className="p-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="พิมพ์ชื่อ / เลขผู้เสียภาษี / รหัส Vendor"
              className="text-[11px] px-2 py-1 rounded-lg w-full outline-none"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
            />
          </div>
          <div className="max-h-56 overflow-y-auto slim-scroll">
            {vendors === "loading" ? (
              <p className="px-3 py-2 text-[11px] m-0" style={{ color: "var(--text-muted)" }}>กำลังโหลด…</p>
            ) : vendors === "failed" ? (
              <p className="px-3 py-2 text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                โหลดรายชื่อ Vendor ไม่สำเร็จ — ปิดแล้วเปิดใหม่เพื่อลองอีกครั้ง
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => { onPick(null); setOpen(false); setTerm(""); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer border-none bg-transparent"
                  style={{ color: "var(--text-muted)" }}
                >
                  — ไม่เลือก Vendor (เว้นว่าง) —
                </button>
                {shortlist.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                    ไม่พบ Vendor ที่ตรงกับที่พิมพ์
                  </p>
                ) : (
                  shortlist.map((c) => {
                    const sameTin = hasTin && (c.taxRegistrationNumber ?? "").replace(/\D/g, "") === tin;
                    return (
                      <button
                        key={c.vendorNo}
                        type="button"
                        onClick={() => { onPick(c.vendorNo); setOpen(false); setTerm(""); }}
                        className="w-full text-left px-3 py-1.5 cursor-pointer border-none bg-transparent hover:bg-[var(--bg-badge)]"
                        style={{ background: c.vendorNo === chosenNo ? "var(--nav-active-bg)" : "transparent" }}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--nav-active-text)" }}>{c.vendorNo}</span>
                          {sameTin && (
                            <span className="text-[9px] px-1 rounded shrink-0"
                              style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)" }}>
                              ตรงเลขภาษี
                            </span>
                          )}
                          <span className="text-[11px] truncate" style={{ color: "var(--text-primary)" }}>{c.displayName ?? "—"}</span>
                        </span>
                        {c.taxRegistrationNumber && (
                          <span className="block text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>
                            {c.taxRegistrationNumber}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </>
            )}
          </div>
        </PickerPanel>
      )}
    </div>
  );
}
