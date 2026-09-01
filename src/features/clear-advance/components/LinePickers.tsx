"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { BranchOption, GlAccountOption } from "@/features/clear-advance/types";

/** Shared with ClearAdvanceForm's table cells and the OCR confirm modal so an
 *  expense field looks the same wherever it is edited. */
export const cellClass = "text-[12px] px-2 py-1.5 rounded-lg outline-none";
export const cellStyle = {
  background: "var(--bg-input, var(--bg-card))",
  color: "var(--text-primary)",
  border: "1px solid var(--border-card)",
} as const;

/** Anchor a popup to its button in viewport coords (position: fixed) so it floats
 *  ABOVE the table's overflow container / the dialog instead of being clipped. */
type Anchor = { top: number; left: number; width: number; above: boolean };

function useAnchoredPopup(open: boolean, setOpen: (v: boolean) => void) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Anchor | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(260, Math.min(320, window.innerWidth - 16));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - r.bottom;
      const above = spaceBelow < 280 && r.top > spaceBelow;
      setPos({ top: above ? r.top - 4 : r.bottom + 4, left, width, above });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", place, true); // capture: follows any scroll container
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, setOpen]);

  return { btnRef, popRef, pos };
}

function popupStyle(pos: Anchor) {
  return {
    top: pos.above ? undefined : pos.top,
    bottom: pos.above ? window.innerHeight - pos.top : undefined,
    left: pos.left,
    width: pos.width,
    background: "var(--bg-dropdown, var(--bg-card))",
    border: "1px solid var(--border-card)",
    boxShadow: "var(--shadow-dropdown)",
  } as const;
}

/** Searchable G/L account picker (`glAccountNo — nameTh`). */
export function GlPicker({
  options, valueNo, disabled, noBranch, onPick,
}: {
  options: GlAccountOption[];
  valueNo: string;
  disabled?: boolean;
  /** The line has no branch yet, so the account list cannot be narrowed. */
  noBranch?: boolean;
  onPick: (o: GlAccountOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { btnRef, popRef, pos } = useAnchoredPopup(open, setOpen);
  const selected = options.find((o) => o.glAccountNo === valueNo) ?? null;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = !term
      ? options
      : options.filter((o) =>
          o.glAccountNo.toLowerCase().includes(term) ||
          (o.nameTh ?? "").toLowerCase().includes(term) ||
          (o.nameEn ?? "").toLowerCase().includes(term));
    return base.slice(0, 60);
  }, [q, options]);

  return (
    <div className="relative">
      <button ref={btnRef} type="button" disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}
        aria-label={selected ? `รายการ: ${selected.glAccountNo} ${selected.nameTh ?? ""}` : "เลือกรายการบัญชี"}
        className={`${cellClass} w-full text-left flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60`}
        style={{ ...cellStyle, minHeight: 32 }}>
        <span className="flex-1 min-w-0 truncate" style={{ color: selected ? "var(--text-primary)" : "var(--text-faint)" }}>
          {selected ? `${selected.glAccountNo} — ${selected.nameTh ?? ""}` : (noBranch ? "เลือกสาขาก่อน" : "— เลือกรายการ —")}
        </span>
        <Search size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="fixed z-[80] rounded-xl overflow-hidden" style={popupStyle(pos)}>
          <div className="p-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <input autoFocus className={cellClass} style={{ ...cellStyle, width: "100%" }}
              aria-label="ค้นหาเลขบัญชี / ชื่อบัญชี"
              placeholder="ค้นหาเลขบัญชี / ชื่อบัญชี" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-56 overflow-y-auto slim-scroll">
            {valueNo && (
              <button type="button" onClick={() => { onPick(null); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer border-none bg-transparent"
                style={{ color: "var(--text-muted)" }}>
                ล้างการเลือก
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[12px] m-0" style={{ color: "var(--text-muted)" }}>ไม่พบบัญชี</p>
            ) : filtered.map((o) => (
              <button key={o.glAccountNo} type="button"
                onClick={() => { onPick(o); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-1.5 cursor-pointer border-none bg-transparent hover:opacity-80"
                style={{ background: o.glAccountNo === valueNo ? "var(--nav-active-bg)" : "transparent" }}>
                <span className="block text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{o.glAccountNo}</span>
                <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{o.nameTh ?? o.nameEn ?? ""}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Branch dimension picker — searchable, shows only the Code in the field. */
export function BranchPicker({
  options, value, disabled, noBrand, onPick,
}: {
  options: BranchOption[];
  value: string;
  disabled?: boolean;
  noBrand?: boolean;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { btnRef, popRef, pos } = useAnchoredPopup(open, setOpen);
  const selected = options.find((o) => o.code === value) ?? null;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = !term
      ? options
      : options.filter((o) =>
          o.code.toLowerCase().includes(term) ||
          (o.name ?? "").toLowerCase().includes(term));
    return base.slice(0, 80);
  }, [q, options]);

  return (
    <div className="relative">
      <button ref={btnRef} type="button" disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}
        aria-label={selected ? `สาขา: ${selected.code}` : "เลือกสาขา"}
        className={`${cellClass} w-full text-left flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60`}
        style={{ ...cellStyle, minHeight: 32 }}>
        <span className="flex-1 min-w-0 truncate" style={{ color: selected ? "var(--text-primary)" : "var(--text-faint)" }}>
          {selected ? selected.code : (noBrand ? "เลือกแบรนด์ก่อน" : "— เลือก —")}
        </span>
        <Search size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="fixed z-[80] rounded-xl overflow-hidden" style={popupStyle(pos)}>
          <div className="p-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <input autoFocus className={cellClass} style={{ ...cellStyle, width: "100%" }}
              aria-label="ค้นหาสาขา"
              placeholder="ค้นหาสาขา (Code / ชื่อ)" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-56 overflow-y-auto slim-scroll">
            {value && (
              <button type="button" onClick={() => { onPick(""); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer border-none bg-transparent"
                style={{ color: "var(--text-muted)" }}>
                ล้างการเลือก
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[12px] m-0" style={{ color: "var(--text-muted)" }}>ไม่พบสาขา</p>
            ) : filtered.map((o) => (
              <button key={o.code} type="button"
                onClick={() => { onPick(o.code); setOpen(false); setQ(""); }}
                className="w-full text-left px-3 py-1.5 cursor-pointer border-none bg-transparent hover:opacity-80"
                style={{ background: o.code === value ? "var(--nav-active-bg)" : "transparent" }}>
                <span className="block text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{o.code}</span>
                {o.name && <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{o.name}</span>}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
