"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import type { ExpenseAccount } from "@/lib/acc/reimburse/expense-account-service";

/**
 * The `รายการ` cell: which G/L account this expense line is booked to.
 *
 * A searchable list rather than a `<select>`. There are around 280 postable
 * expense accounts per brand, and a native select of that length is a scroll
 * with no way to find "ค่าเดินทาง" except by eye. Typing filters on both the
 * number and the Thai name, because people arrive knowing one or the other.
 *
 * **The stored value is the account number**, not the name — that is what
 * Business Central posts against, and a display name can change on the next
 * sync while the number does not. The cell shows both, stacked: the number
 * small and grey above, the name below in full. One line put them in
 * competition for 190px and the name always lost, which is the half that tells
 * a reader whether the account is the right one.
 *
 * Two states it has to render honestly rather than as an empty list:
 *
 * - **no brand chosen yet** — `ErpAccounts` is keyed on brand, so there is
 *   nothing to offer and the reason is not the requester's fault.
 * - **a value that is not in the list** — a claim filed before this column
 *   meant an ERP account holds free text like "AP-4.2", and an account used
 *   last year may since have been blocked in BC. Showing the raw value beats
 *   silently blanking a field somebody filled in.
 */
export function ExpenseAccountPicker({
  value,
  onChange,
  accounts,
  loading,
  brandChosen,
  ariaLabel,
}: {
  /** `ErpAccounts.AccountNo`, or free text on an older row, or null. */
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  accounts: ExpenseAccount[];
  loading?: boolean;
  /** False before a brand is picked — the list cannot be loaded at all yet. */
  brandChosen: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => accounts.find((a) => a.accountNo === value) ?? null,
    [accounts, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts.slice(0, MAX_VISIBLE);
    // Number and name both, because people arrive knowing one or the other.
    return accounts
      .filter((a) => a.accountNo.includes(q) || a.displayName.toLowerCase().includes(q))
      .slice(0, MAX_VISIBLE);
  }, [accounts, query]);

  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, Math.min(window.innerWidth - 32, 420));
      setRect({
        top: r.bottom + 4,
        // Kept on screen: this cell sits mid-row and a 420px panel anchored to
        // it would otherwise overflow the viewport on the right.
        left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)),
        width,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Focused a frame late: the panel is portalled, so it is not in the DOM
    // until after this effect's first synchronous pass.
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const placeholder = !brandChosen ? "เลือกแบรนด์ก่อน" : loading ? "กำลังโหลด..." : "เลือกบัญชี...";

  /** The `title` — one line, because a tooltip has no second one. */
  const tooltip = selected
    ? `${selected.accountNo} — ${selected.displayName}`
    : value || placeholder;

  const panel =
    open && rect ? (
      <div
        ref={panelRef}
        className="rounded-xl overflow-hidden flex flex-col"
        style={{
          position: "fixed",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          maxHeight: 340,
          zIndex: 200,
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
          <Search size={14} style={{ color: "var(--text-muted)" }} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเลขบัญชีหรือชื่อ..."
            className="flex-1 min-w-0 text-[13px] outline-none bg-transparent border-none"
            style={{ color: "var(--text-primary)" }}
          />
        </div>

        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="text-[12.5px] text-center py-4 m-0" style={{ color: "var(--text-faint)" }}>
              {accounts.length === 0 ? "ไม่มีบัญชีให้เลือก" : "ไม่พบบัญชีที่ค้นหา"}
            </p>
          ) : (
            filtered.map((a) => (
              <button
                key={a.accountNo}
                type="button"
                onClick={() => {
                  onChange(a.accountNo);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-left px-3 py-2 cursor-pointer border-none block"
                style={{
                  background: a.accountNo === value ? "var(--nav-active-bg)" : "transparent",
                }}
              >
                {/* The same two lines as the cell above, so what is picked here
                    looks like what appears there. Side by side, a long Thai
                    account name pushed the number and the name into competing
                    for one row's width — the option list has more of it than
                    the 190px cell does, but making the two read differently
                    for that reason costs more than it buys. */}
                <span
                  className="block text-[10.5px] leading-tight tabular-nums truncate"
                  style={{ color: "var(--text-muted)" }}
                >
                  {a.accountNo}
                </span>
                <span
                  className="block text-[13px] leading-tight truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {a.displayName}
                </span>
              </button>
            ))
          )}
        </div>

        {value && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="text-[12px] font-medium cursor-pointer border-none bg-transparent px-3 py-2 text-left"
            style={{ borderTop: "1px solid var(--border-light)", color: "var(--text-muted)" }}
          >
            ล้างค่า
          </button>
        )}
      </div>
    ) : null;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        disabled={!brandChosen}
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-lg px-3 py-1.5 outline-none flex items-center gap-1.5 disabled:cursor-not-allowed"
        style={{
          background: "var(--bg-input)",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "var(--border-input)",
          cursor: brandChosen ? "pointer" : "not-allowed",
          opacity: brandChosen ? 1 : 0.7,
        }}
        title={tooltip}
      >
        {/* Two lines, the number above the name. The column is 190px and a
            Thai account name routinely runs past that, so one line meant the
            name was always the half that got truncated — and the name is what
            tells a reader whether the account is right. Stacked, the number
            fits whole and the name gets the full width to itself. */}
        <span className="min-w-0 flex-1 text-left">
          {selected ? (
            <>
              <span
                className="block text-[10.5px] leading-tight tabular-nums truncate"
                style={{ color: "var(--text-muted)" }}
              >
                {selected.accountNo}
              </span>
              <span
                className="block text-[13px] leading-tight truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {selected.displayName}
              </span>
            </>
          ) : (
            // One line: either a raw value that is not an account at all — an
            // older free-text `รายการ`, or one since blocked in BC — or the
            // placeholder. Neither has a number and a name to separate.
            <span
              className="block text-[13px] leading-tight truncate py-[7px]"
              style={{ color: value ? "var(--text-primary)" : "var(--text-muted)" }}
            >
              {value || placeholder}
            </span>
          )}
        </span>
        <ChevronDown size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      </button>

      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}

/**
 * How many rows the panel renders at once.
 *
 * Every account is searchable; this bounds what is *painted*. Around 280
 * options per brand is not enough to need virtualising, but rendering all of
 * them on every keystroke is work nobody sees — a list longer than this is not
 * being read, it is being searched.
 */
const MAX_VISIBLE = 60;
