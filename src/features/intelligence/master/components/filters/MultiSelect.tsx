"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useDistincts } from "@/features/intelligence/master/hooks/useDistincts";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { FilterKey, FILTER_KEYS } from "@/features/intelligence/master/types";

interface Props {
  brand: string;
  label: string;
  col: string;
  values: string[];
  onChange: (v: string[]) => void;
  formatLabel?: (raw: string) => string;
  sortBy?: (a: string, b: string) => number;
  /** When true, button never inlines selected names — always shows "All" or
   *  "<n> selected". Used by Date filter to keep the chip compact. */
  hideSelectedInTrigger?: boolean;
  /** When true, an empty `values` array is treated as "every cascade-
   *  matching option is implicitly selected" — every checkbox renders
   *  ticked, the trigger reads "All", and toggling materialises an
   *  explicit IN-list. Default `false`: empty draft means nothing is
   *  ticked, click adds to selection.
   *
   *  Used selectively for void_flag / is_revenue — binary data-quality
   *  filters where "everything ticked" reads naturally as "show all
   *  data, no constraint". Bulkier filters (branch, category, menu)
   *  default to the simpler "nothing ticked" appearance to avoid a
   *  wall of pre-checked boxes. */
  autoTickWhenEmpty?: boolean;
}

const PANEL_WIDTH = 240;

/** How long to wait after the user's last toggle before pushing the
 *  selection up to the URL (and triggering chart refetches). On panel
 *  close we commit immediately, ignoring the timer. */
const COMMIT_DEBOUNCE_MS = 600;

function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const v of b) if (!setA.has(v)) return false;
  return true;
}

export function MultiSelect({
  brand,
  label,
  col,
  values,
  onChange,
  formatLabel,
  sortBy,
  hideSelectedInTrigger,
  autoTickWhenEmpty = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fmt = useMemo(
    () => formatLabel ?? ((v: string) => v),
    [formatLabel]
  );

  // ─── Cascade context ──────────────────────────────────────────────
  // Pass every other filter to the distincts API so this dropdown's
  // option list reflects rows that survive the rest of the filters.
  // The hook short-circuits cascading for `col === "ym"`.
  const { filters: allFilters } = useMasterFilters();
  const filtersForDistinct = useMemo(() => {
    const out: Record<string, string[] | undefined> = {};
    for (const k of FILTER_KEYS) {
      if (k === col) continue; // exclude self
      const v = allFilters[k as FilterKey];
      if (v && v.length > 0) out[k] = v;
    }
    return out;
  }, [allFilters, col]);

  const { options: rawOptions, loading, error } = useDistincts(
    brand,
    col,
    filtersForDistinct
  );

  // RocksFast useDistincts returns string[] (no count). Wrap into a
  // local shape so the rest of the component can treat all options as
  // "count = 1" (always visible, never muted).
  const options = useMemo(() => {
    if (!rawOptions) return null;
    const sorted = sortBy ? [...rawOptions].sort(sortBy) : rawOptions;
    return sorted;
  }, [rawOptions, sortBy]);

  // ─── Local "draft" state for debounced URL commits ────────────────
  // Toggles update `draft` immediately so checkboxes feel responsive,
  // but we only push the change up to the URL after the user has
  // stopped interacting for COMMIT_DEBOUNCE_MS — or once the panel
  // closes, whichever comes first. This prevents a chart refresh
  // on every individual click.
  const [draft, setDraft] = useState<string[]>(values);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set whenever the user has an uncommitted edit; reset on commit.
  // Without this gate, external value changes (auto-default writes,
  // Clear All, branch_id↔branch_name mirror) would echo a stale
  // draft back into the URL when the panel later closes.
  const userEditedRef = useRef(false);

  // Re-sync draft when external `values` change (URL navigation /
  // Clear All / programmatic update) — but only when no in-progress
  // user edit is pending so we don't clobber unsaved keystrokes.
  useEffect(() => {
    if (userEditedRef.current) return;
    if (!arraysEqualUnordered(draftRef.current, values)) {
      setDraft(values);
    }
  }, [values]);

  const flushCommit = useCallback(() => {
    if (!userEditedRef.current) return;
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    userEditedRef.current = false;
    if (!arraysEqualUnordered(draftRef.current, values)) {
      onChange(draftRef.current);
    }
  }, [onChange, values]);

  const scheduleCommit = useCallback(
    (next: string[]) => {
      userEditedRef.current = true;
      setDraft(next);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      commitTimerRef.current = setTimeout(() => {
        commitTimerRef.current = null;
        userEditedRef.current = false;
        if (!arraysEqualUnordered(next, values)) {
          onChange(next);
        }
      }, COMMIT_DEBOUNCE_MS);
    },
    [onChange, values]
  );

  // Flush any pending commit on unmount so changes aren't lost if
  // the user navigates away mid-debounce.
  useEffect(() => {
    return () => {
      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      if (
        userEditedRef.current &&
        !arraysEqualUnordered(draftRef.current, values)
      ) {
        userEditedRef.current = false;
        onChange(draftRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Position the panel using fixed coords so ancestor overflow can't clip it.
  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      let left = rect.right - PANEL_WIDTH;
      if (left < 8) left = 8;
      if (left + PANEL_WIDTH > vw - 8) left = vw - PANEL_WIDTH - 8;
      setCoords({ top: rect.bottom + 4, left });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // ─── Transient "Clear all" mode ───────────────────────────────────
  // Activated by the per-filter "Clear all" button. Visually unticks
  // every option without committing to the URL — the user is then
  // expected to tick the specific items they want, at which point we
  // exit the mode and treat their first tick as the start of an
  // explicit IN list. Closing the panel without picking anything
  // cancels the mode (URL stays untouched).
  const [untickMode, setUntickMode] = useState(false);

  // When the panel closes: cancel the transient untick mode (so the
  // next time the user opens the panel they see the normal state) and
  // flush any pending debounced commit so the chart updates promptly.
  useEffect(() => {
    if (open) return;
    if (untickMode) setUntickMode(false);
    flushCommit();
  }, [open, untickMode, flushCommit]);

  const allOptions = useMemo(() => options ?? [], [options]);

  // Search filter — applied across every distinct value the cascade
  // returned; orphan entries (selected but no longer in cascade) are
  // shown in their own section below and are searched separately.
  const matchesQuery = useCallback(
    (raw: string) => {
      if (query.length === 0) return true;
      const q = query.toLowerCase();
      return (
        raw.toLowerCase().includes(q) || fmt(raw).toLowerCase().includes(q)
      );
    },
    [query, fmt]
  );
  const filteredOptions = allOptions.filter((v) => matchesQuery(v));

  // Orphans — values still in the user's draft IN-list that aren't in
  // the current cascade option set. Shown greyed with a "no match"
  // hint so the user keeps visibility into their full intent. Toggling
  // an orphan removes it from the draft.
  const cascadeValuesSet = useMemo(
    () => new Set(allOptions),
    [allOptions]
  );
  const orphanedSelections = useMemo(
    () => draft.filter((v) => !cascadeValuesSet.has(v) && matchesQuery(v)),
    [draft, cascadeValuesSet, matchesQuery]
  );

  // The "current visual selection" when draft is empty AND we're in
  // auto-tick mode — i.e. all cascade options. Used to seed the
  // explicit IN list when the user toggles their first checkbox out
  // of the empty/all-selected state.
  const autoTickedValues = useMemo(() => allOptions, [allOptions]);

  // VISUAL semantics:
  //   - untickMode (transient)              → every checkbox empty
  //   - autoTickWhenEmpty + draft empty     → ticked for all cascade options
  //   - !autoTickWhenEmpty + draft empty    → every checkbox empty
  //   - draft non-empty                     → ticked iff in draft
  const isChecked = (value: string) => {
    if (untickMode) return false;
    if (draft.length === 0) return autoTickWhenEmpty;
    return draft.includes(value);
  };
  const selectedCount = draft.length;

  function toggle(v: string) {
    // Coming out of "Clear all" — first tick becomes the entire draft.
    if (untickMode) {
      setUntickMode(false);
      scheduleCommit([v]);
      return;
    }
    let next: string[];
    if (draft.length === 0) {
      if (autoTickWhenEmpty) {
        // Empty draft was visually showing every option ticked.
        // Materialise that set, then toggle the clicked value.
        const seed = new Set(autoTickedValues);
        if (seed.has(v)) seed.delete(v);
        else seed.add(v);
        next = Array.from(seed);
      } else {
        // Plain "click adds to selection" — first pick becomes [v].
        next = [v];
      }
    } else if (draft.includes(v)) {
      next = draft.filter((o) => o !== v);
    } else {
      next = [...draft, v];
    }
    // Normalise back to "empty" only for auto-tick filters, where
    // empty = "visually all-ticked" (the natural rest state). For
    // plain filters, an explicit "all" selection should stay in the
    // URL so the user can see what they picked.
    if (
      autoTickWhenEmpty &&
      next.length === autoTickedValues.length &&
      next.every((x) => autoTickedValues.includes(x))
    ) {
      next = [];
    }
    scheduleCommit(next);
  }

  function selectAllVisible() {
    setUntickMode(false);
    if (query.length === 0) {
      if (autoTickWhenEmpty) {
        // Collapse to empty (= visually all-ticked default).
        scheduleCommit([]);
        return;
      }
      // Plain mode — write every cascade option explicitly so the
      // user can see what got selected.
      scheduleCommit([...allOptions]);
      return;
    }
    // Search active — union the visible matches into the current
    // selection.
    const base =
      draft.length === 0 && autoTickWhenEmpty
        ? new Set(autoTickedValues)
        : new Set(draft);
    for (const v of filteredOptions) base.add(v);
    let next = Array.from(base);
    if (
      autoTickWhenEmpty &&
      next.length === autoTickedValues.length &&
      next.every((x) => autoTickedValues.includes(x))
    ) {
      next = [];
    }
    scheduleCommit(next);
  }

  function clearAll() {
    if (autoTickWhenEmpty) {
      // Auto-tick mode: empty draft already means "all selected", so
      // resetting to empty wouldn't visually clear anything. Use a
      // transient untick state instead — every checkbox empties out
      // (no URL write yet), and the user's next tick starts a fresh
      // explicit selection.
      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      userEditedRef.current = false;
      setUntickMode(true);
      return;
    }
    // Plain mode: just empty the draft.
    setUntickMode(false);
    scheduleCommit([]);
  }

  const showSkeleton = loading && options === null;

  const panel = open && coords && (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: PANEL_WIDTH,
        zIndex: 9999,
        background: "var(--bg-card)",
        borderColor: "var(--border-subtle)",
      }}
      className="rounded-md border shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="p-2 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-inset"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--bg-card)",
            color: "var(--text-primary)",
          }}
        />
      </div>
      <div className="max-h-60 overflow-y-auto py-1 scroll-thin">
        {error ? (
          <div className="px-3 py-2 text-xs text-red-600">{error}</div>
        ) : showSkeleton ? (
          <div className="flex flex-col gap-1 px-2 py-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-5 rounded skeleton" />
            ))}
          </div>
        ) : filteredOptions.length === 0 && orphanedSelections.length === 0 ? (
          <div
            className="px-3 py-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            No options
          </div>
        ) : (
          <>
            {filteredOptions.map((value) => {
              const checked = isChecked(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggle(value)}
                  className="w-full flex items-center gap-2 px-2 py-1 pointer-coarse:py-2.5 text-xs text-left"
                  style={{
                    background: checked
                      ? "var(--color-accent, #b89a5a)1a"
                      : "transparent",
                    color: "var(--text-primary)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "var(--bg-hover, rgba(0,0,0,0.05))";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      checked ? "var(--color-accent, #b89a5a)1a" : "transparent";
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border"
                    style={{
                      background: checked
                        ? "var(--color-accent, #b89a5a)"
                        : "var(--bg-card)",
                      borderColor: checked
                        ? "var(--color-accent, #b89a5a)"
                        : "var(--border-subtle)",
                      color: "white",
                    }}
                  >
                    {checked && (
                      <svg viewBox="0 0 12 12" className="h-3 w-3">
                        <path
                          d="M2.5 6.5l2.5 2.5 4.5-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="truncate flex-1">{fmt(value)}</span>
                </button>
              );
            })}
            {orphanedSelections.length > 0 && (
              <>
                <div
                  className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider border-t mt-1"
                  style={{
                    color: "var(--text-muted)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  Selected — no match in current scope
                </div>
                {orphanedSelections.map((value) => (
                  <button
                    key={`orphan-${value}`}
                    type="button"
                    onClick={() => toggle(value)}
                    title="No rows match this value given the other filters. Untick to remove from the URL."
                    className="w-full flex items-center gap-2 px-2 py-1 pointer-coarse:py-2.5 text-xs text-left opacity-60"
                    style={{ color: "var(--text-primary)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "var(--bg-hover, rgba(0,0,0,0.05))";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "transparent";
                    }}
                  >
                    <span
                      aria-hidden
                      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border"
                      style={{
                        background: "var(--border-subtle)",
                        borderColor: "var(--text-muted)",
                        color: "white",
                      }}
                    >
                      <svg viewBox="0 0 12 12" className="h-3 w-3">
                        <path
                          d="M2.5 6.5l2.5 2.5 4.5-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="truncate flex-1 line-through">
                      {fmt(value)}
                    </span>
                    <span
                      className="ml-1 shrink-0 text-[10px] italic"
                      style={{ color: "var(--text-muted)" }}
                    >
                      no match
                    </span>
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>
      <div
        className="flex justify-between items-center p-2 border-t gap-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button
          type="button"
          onClick={selectAllVisible}
          disabled={filteredOptions.length === 0}
          className="text-[11px] disabled:opacity-40"
          style={{ color: "var(--text-muted)" }}
          title="Tick every visible option"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={
            untickMode ||
            filteredOptions.length === 0 ||
            (!autoTickWhenEmpty && selectedCount === 0)
          }
          className="text-[11px] disabled:opacity-40"
          style={{ color: "var(--text-muted)" }}
          title="Untick everything so you can pick a few items from scratch"
        >
          Clear all
        </button>
        <span
          className="text-[11px] ml-auto"
          style={{ color: "var(--text-muted)" }}
        >
          {untickMode
            ? "Pick items"
            : selectedCount === 0
            ? "All"
            : `${selectedCount} selected`}
        </span>
      </div>
    </div>
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full text-left text-xs rounded-md border px-2 py-1.5 pointer-coarse:py-2.5 focus:outline-none focus:ring-1 focus:ring-inset ${
          selectedCount > 0 ? "ring-1 ring-inset" : ""
        }`}
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-card)",
          color: "var(--text-primary)",
          // accent ring uses CSS var
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <span
          className="ml-1 truncate inline-block max-w-[140px] align-bottom"
          style={{ color: "var(--text-primary)" }}
        >
          {untickMode
            ? "Pick items…"
            : hideSelectedInTrigger
            ? selectedCount === 0
              ? "All"
              : `${selectedCount} selected`
            : selectedCount === 0
            ? "All"
            : selectedCount === 1
            ? fmt(draft[0])
            : selectedCount <= 3
            ? draft.map(fmt).join(", ")
            : `${selectedCount} selected`}
        </span>
        <span
          className="float-right text-[11px] mt-[2px]"
          style={{ color: "var(--text-muted)" }}
        >
          {open ? "▴" : "▾"}
        </span>
      </button>

      {mounted && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
