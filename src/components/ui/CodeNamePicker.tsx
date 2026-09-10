"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

/** One option: a code that is stored, and a name a person reads. */
export interface CodeNameOption {
  /** The value written to the database — an account number, a vendor number. */
  code: string;
  /** What the code means, shown under it. */
  name: string;
}

/** Copy differs per use; the machinery does not. */
export interface CodeNamePickerLabels {
  /** Shown on the trigger when nothing is chosen and the list is ready. */
  placeholder: string;
  /** Shown instead when no brand has been chosen — the list cannot exist yet. */
  noBrand: string;
  loading: string;
  search: string;
  /** The list is genuinely empty. */
  empty: string;
  /** The list is not empty but nothing matches the query. */
  noMatch: string;
  clear: string;
}

/**
 * A searchable code-and-name picker, portalled so it escapes a table cell.
 *
 * Extracted from `ExpenseAccountPicker`, which had solved all of this for AP-4's
 * G/L column, when the same cell was needed for a Business Central vendor. The
 * two lists differ in size (around 280 accounts per brand, up to 1,604 vendor
 * cards) and in nothing else that matters here, so this is that component with
 * its copy lifted out rather than a second implementation. `CodeNamePicker` is
 * the only place the dropdown exists; `picker-extraction-guard.test.ts` pins it.
 *
 * Three states it renders honestly rather than as an empty list:
 *
 * - **no brand chosen yet** — both lists are keyed on brand, so there is
 *   nothing to offer and the reason is not the reader's fault.
 * - **still loading** — said, not shown as "nothing to choose".
 * - **a stored value that is not in the list** — the important one. An AP-4
 *   claim filed before that column meant an ERP account holds free text like
 *   "AP-4.2", and a vendor chosen last year may since have been blocked in BC.
 *   The raw value is shown. Blanking a field somebody filled in, because
 *   today's list no longer offers it, destroys the only record of it on screen.
 *
 * **Two lines, code above name**, in the trigger and in every option alike. The
 * cell is narrow and a Thai account or vendor name routinely runs past it, so
 * one line meant the name was always the half truncated — and the name is what
 * tells a reader whether the choice is right.
 *
 * **Filtering happens here, in the browser, over the whole list.** For vendors
 * that is not an optimisation, it is the fix: `ErpVendors.DisplayName` is
 * `Thai_CI_AS`, where SQL `LIKE` compares collation elements — a Thai consonant
 * and the mark above it are one — so a substring pattern failed to match the
 * very name it was taken from. JavaScript compares code units. See
 * `listTaxVendors`, which sends the whole list for this reason.
 */
export function CodeNamePicker({
  value,
  onChange,
  options,
  labels,
  loading,
  brandChosen,
  ariaLabel,
}: {
  /** The stored code, free text on an older row, or null. */
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  options: CodeNameOption[];
  labels: CodeNamePickerLabels;
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
    () => options.find((o) => o.code === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_VISIBLE);
    // Code and name both, because people arrive knowing one or the other.
    return options
      .filter((o) => o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
      .slice(0, MAX_VISIBLE);
  }, [options, query]);

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

  const placeholder = !brandChosen ? labels.noBrand : loading ? labels.loading : labels.placeholder;

  /** The `title` — one line, because a tooltip has no second one. */
  const tooltip = selected ? `${selected.code} — ${selected.name}` : value || placeholder;

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
            placeholder={labels.search}
            className="flex-1 min-w-0 text-[13px] outline-none bg-transparent border-none"
            style={{ color: "var(--text-primary)" }}
          />
        </div>

        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="text-[12.5px] text-center py-4 m-0" style={{ color: "var(--text-faint)" }}>
              {/* Told apart deliberately: "there are none" and "your search
                  found none" send a reader to different places. */}
              {options.length === 0 ? labels.empty : labels.noMatch}
            </p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.code}
                type="button"
                onClick={() => {
                  onChange(o.code);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-left px-3 py-2 cursor-pointer border-none block"
                style={{ background: o.code === value ? "var(--nav-active-bg)" : "transparent" }}
              >
                {/* The same two lines as the cell above, so what is picked here
                    looks like what appears there. */}
                <span
                  className="block text-[10.5px] leading-tight tabular-nums truncate"
                  style={{ color: "var(--text-muted)" }}
                >
                  {o.code}
                </span>
                <span className="block text-[13px] leading-tight truncate" style={{ color: "var(--text-primary)" }}>
                  {o.name}
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
            {labels.clear}
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
        <span className="min-w-0 flex-1 text-left">
          {selected ? (
            <>
              <span
                className="block text-[10.5px] leading-tight tabular-nums truncate"
                style={{ color: "var(--text-muted)" }}
              >
                {selected.code}
              </span>
              <span className="block text-[13px] leading-tight truncate" style={{ color: "var(--text-primary)" }}>
                {selected.name}
              </span>
            </>
          ) : (
            // One line: either a raw value that is not in the list at all — an
            // older free-text entry, or an option since blocked in BC — or the
            // placeholder. Neither has a code and a name to separate.
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
 * Every option is searchable; this bounds what is *painted*. A list longer than
 * this is not being read, it is being searched — and it matters more for
 * vendors than it did for accounts: 1,604 cards rendered on every keystroke is
 * work nobody sees.
 */
const MAX_VISIBLE = 60;
