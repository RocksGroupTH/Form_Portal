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
import {
  dayDateRange,
  dayOfWeekMonFirst,
  daysInMonth,
  formatMonthYear,
  formatWeekRange,
  getISOWeek,
  isoDate,
  isoWeekRange,
  weekNumber,
  weeksInMonth,
} from "@/features/intelligence/master/lib/format";
import { useDistincts } from "@/features/intelligence/master/hooks/useDistincts";

type Period = "monthly" | "weekly" | "daily";

interface Props {
  brand: string;
  period: Period;
  selectedMonths: string[];
  selectedWeeks: string[];
  selectedDays: string[];
  /** Months available — typically the same set the dashboard's date
   *  filter offers (data-backed). Newest first inside the picker. */
  months: string[];
  onChange: (next: {
    period: Period;
    months: string[];
    weeks: string[];
    days: string[];
  }) => void;
}

/** A compact chip + floating dropdown that lets the analyst pick the
 *  date scope of the export. Replaces a full inline accordion that
 *  would otherwise push the modal's footer (with the Download button)
 *  off-screen when expanded.
 *
 *  Body content is rendered via React.createPortal to document.body
 *  with `position: fixed` coords computed from the trigger's
 *  bounding rect — so the popup is never clipped by the modal's
 *  overflow boundary. Z-index sits above the modal (10500) and the
 *  popup tracks the trigger on resize / scroll. */
export function PeriodPicker({
  brand,
  period,
  selectedMonths,
  selectedWeeks,
  selectedDays,
  months,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const PANEL_W = 340;
      const vw = window.innerWidth;
      let left = rect.right - PANEL_W;
      if (left < 8) left = 8;
      if (left + PANEL_W > vw - 8) left = vw - PANEL_W - 8;
      setCoords({ top: rect.bottom + 6, left, width: PANEL_W });
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

  const triggerLabel = useMemo(() => {
    if (period === "monthly") {
      const n = selectedMonths.length;
      if (n === 0) return "No months picked";
      if (n === 1) return formatMonthYear(selectedMonths[0]);
      return `${n} months`;
    }
    if (period === "weekly") {
      const n = selectedWeeks.length;
      if (n === 0) return "No weeks picked";
      if (n === 1) return `Week ${weekNumber(selectedWeeks[0])}`;
      return `${n} weeks`;
    }
    const n = selectedDays.length;
    if (n === 0) return "No days picked";
    if (n === 1) return formatDayLabel(selectedDays[0]);
    return `${n} days`;
  }, [period, selectedMonths, selectedWeeks, selectedDays]);

  const isWarning =
    (period === "monthly" && selectedMonths.length === 0) ||
    (period === "weekly" && selectedWeeks.length === 0) ||
    (period === "daily" && selectedDays.length === 0);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center justify-between gap-1.5 h-8 px-2.5 text-xs rounded-md transition-colors"
        style={{
          background: "var(--bg-elevated)",
          border: isWarning
            ? "1px solid var(--warning, #d97706)"
            : "1px solid var(--border-card)",
          color: "var(--text-primary)",
        }}
        title={
          period === "monthly"
            ? "Pick which months to export"
            : period === "weekly"
              ? "Pick which ISO weeks to export"
              : "Pick which calendar days to export"
        }
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
          <span className="font-semibold capitalize" style={{ color: "var(--text-primary)" }}>
            {period}
          </span>
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <span
            className="truncate"
            style={{ color: isWarning ? "var(--warning, #d97706)" : "var(--text-primary)" }}
          >
            {triggerLabel}
          </span>
        </span>
        <CaretIcon
          className="h-3 w-3 shrink-0 transition-transform"
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {mounted && open && coords ? (
        <PortalPanel
          panelRef={panelRef}
          coords={coords}
          brand={brand}
          period={period}
          selectedMonths={selectedMonths}
          selectedWeeks={selectedWeeks}
          selectedDays={selectedDays}
          months={months}
          onChange={onChange}
        />
      ) : null}
    </>
  );
}

function PortalPanel({
  panelRef,
  coords,
  brand,
  period,
  selectedMonths,
  selectedWeeks,
  selectedDays,
  months,
  onChange,
}: {
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  coords: { top: number; left: number; width: number };
  brand: string;
  period: Period;
  selectedMonths: string[];
  selectedWeeks: string[];
  selectedDays: string[];
  months: string[];
  onChange: Props["onChange"];
}) {
  const sortedMonths = useMemo(
    () => Array.from(months).sort((a, b) => b.localeCompare(a)),
    [months]
  );

  // Lazy-fetch distinct calendar days the moment the picker opens.
  const { options: dayOptions } = useDistincts(brand, "days");
  const availableDays = useMemo(() => {
    const s = new Set<string>();
    for (const o of dayOptions ?? []) s.add(o);
    return s;
  }, [dayOptions]);
  const availableWeeks = useMemo(() => {
    const s = new Set<string>();
    for (const day of Array.from(availableDays)) {
      const r = dayDateRange(day);
      if (!r) continue;
      s.add(getISOWeek(r.start));
    }
    return s;
  }, [availableDays]);

  function setPeriod(p: Period) {
    onChange({
      period: p,
      months: selectedMonths,
      weeks: selectedWeeks,
      days: selectedDays,
    });
  }
  function setMonths(next: string[]) {
    onChange({
      period,
      months: next,
      weeks: selectedWeeks,
      days: selectedDays,
    });
  }
  function setWeeks(next: string[]) {
    onChange({
      period,
      months: selectedMonths,
      weeks: next,
      days: selectedDays,
    });
  }
  function setDays(next: string[]) {
    onChange({
      period,
      months: selectedMonths,
      weeks: selectedWeeks,
      days: next,
    });
  }

  const node = (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: coords.width,
        zIndex: 10500,
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "0 12px 40px rgba(15,23,42,0.18)",
      }}
      className="rounded-lg overflow-hidden"
      role="dialog"
      aria-label="Pick export period"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Granularity toggle inside the popup */}
      <div
        className="p-2"
        style={{
          borderBottom: "1px solid var(--border-card)",
          background: "var(--bg-elevated)",
        }}
      >
        <div
          className="inline-flex w-full rounded-md overflow-hidden"
          style={{
            border: "1px solid var(--border-card)",
            background: "var(--bg-card)",
          }}
        >
          {(["monthly", "weekly", "daily"] as const).map((p, i) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className="flex-1 h-7 text-[11.5px] font-semibold transition-colors capitalize"
              style={{
                borderLeft: i > 0 ? "1px solid var(--border-card)" : undefined,
                background: period === p ? "var(--accent-subtle)" : undefined,
                color: period === p ? "var(--accent)" : "var(--text-primary)",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {period === "monthly" && (
        <MonthList
          months={sortedMonths}
          selected={selectedMonths}
          onChange={setMonths}
        />
      )}
      {period === "weekly" && (
        <WeekAccordion
          months={sortedMonths}
          selected={selectedWeeks}
          availableWeeks={availableWeeks}
          availableDays={availableDays}
          onChange={setWeeks}
        />
      )}
      {period === "daily" && (
        <DailyAccordion
          months={sortedMonths}
          selected={selectedDays}
          availableDays={availableDays}
          onChange={setDays}
        />
      )}
    </div>
  );

  return createPortal(node, document.body);
}

/* ---------------------------------------------------------------- */
/*  Monthly mode body                                               */
/* ---------------------------------------------------------------- */

function MonthList({
  months,
  selected,
  onChange,
}: {
  months: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const total = selected.length;
  const totalAvailable = months.length;

  function toggle(ym: string) {
    const next = new Set(selected);
    if (next.has(ym)) next.delete(ym);
    else next.add(ym);
    onChange(Array.from(next).sort((a, b) => b.localeCompare(a)));
  }
  function selectAll() {
    onChange(Array.from(months).sort((a, b) => b.localeCompare(a)));
  }
  function clear() {
    onChange([]);
  }

  return (
    <>
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5"
        style={{
          borderBottom: "1px solid var(--border-card)",
          background: "var(--bg-card)",
        }}
      >
        <div
          className="text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          Months
          <span
            className="ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-[1px] text-[9px] font-semibold tabular-nums"
            style={{
              background: "var(--accent-subtle)",
              color: "var(--accent)",
            }}
          >
            {total}
            <span className="opacity-60 mx-0.5">/</span>
            {totalAvailable}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            disabled={total === totalAvailable}
            className="text-[11px] disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            Select all
          </button>
          <span style={{ color: "var(--text-muted)", opacity: 0.4 }}>|</span>
          <button
            type="button"
            onClick={clear}
            disabled={total === 0}
            className="text-[11px] disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="max-h-[260px] overflow-y-auto scroll-thin">
        {months.length === 0 && (
          <div className="px-3 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
            No months available.
          </div>
        )}
        {months.map((ym) => {
          const checked = selectedSet.has(ym);
          return (
            <button
              key={ym}
              type="button"
              onClick={() => toggle(ym)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors"
              style={{
                background: checked ? "var(--accent-subtle)" : undefined,
                color: "var(--text-primary)",
              }}
            >
              <Box state={checked ? "all" : "none"} />
              <span className="flex-1 font-medium">
                {formatMonthYear(ym)}
              </span>
              <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>{ym}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/*  Weekly mode body — accordion of months × weeks                  */
/* ---------------------------------------------------------------- */

function WeekAccordion({
  months,
  selected,
  availableWeeks,
  availableDays,
  onChange,
}: {
  months: string[];
  selected: string[];
  availableWeeks: Set<string>;
  availableDays: Set<string>;
  onChange: (next: string[]) => void;
}) {
  const monthWeeks = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ym of months) out.set(ym, weeksInMonth(ym));
    return out;
  }, [months]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const treatAllAvailable = availableWeeks.size === 0;
  const isAvailable = (w: string) =>
    treatAllAvailable || availableWeeks.has(w);

  const daysWithDataInWeek = useCallback(
    (weekId: string): number => {
      if (treatAllAvailable) return 7;
      const r = isoWeekRange(weekId);
      if (!r) return 0;
      let n = 0;
      const cur = new Date(r.start);
      for (let i = 0; i < 7; i++) {
        if (availableDays.has(isoDate(cur))) n++;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return n;
    },
    [treatAllAvailable, availableDays]
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (months.length > 0) s.add(months[0]);
    return s;
  });
  function toggleExpanded(ym: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym);
      else next.add(ym);
      return next;
    });
  }

  const totalAvailable = useMemo(() => {
    const all = new Set<string>();
    for (const ws of Array.from(monthWeeks.values())) {
      for (const w of ws) if (isAvailable(w)) all.add(w);
    }
    return all.size;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthWeeks, availableWeeks]);

  function commit(next: Iterable<string>) {
    onChange(Array.from(next).sort());
  }
  function toggleWeek(weekId: string) {
    if (!isAvailable(weekId)) return;
    const next = new Set(selected);
    if (next.has(weekId)) next.delete(weekId);
    else next.add(weekId);
    commit(next);
  }
  function toggleMonth(ym: string) {
    const ws = (monthWeeks.get(ym) ?? []).filter(isAvailable);
    if (ws.length === 0) return;
    const allTicked = ws.every((w) => selectedSet.has(w));
    const next = new Set(selected);
    if (allTicked) for (const w of ws) next.delete(w);
    else for (const w of ws) next.add(w);
    commit(next);
  }
  function selectAll() {
    const all = new Set<string>();
    for (const ws of Array.from(monthWeeks.values())) {
      for (const w of ws) if (isAvailable(w)) all.add(w);
    }
    commit(all);
  }
  function clear() {
    onChange([]);
  }

  return (
    <>
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5"
        style={{
          borderBottom: "1px solid var(--border-card)",
          background: "var(--bg-card)",
        }}
      >
        <div
          className="text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          Weeks
          <span
            className="ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-[1px] text-[9px] font-semibold tabular-nums"
            style={{
              background: "var(--accent-subtle)",
              color: "var(--accent)",
            }}
          >
            {selected.length}
            <span className="opacity-60 mx-0.5">/</span>
            {totalAvailable}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            disabled={selected.length === totalAvailable}
            className="text-[11px] disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            Select all
          </button>
          <span style={{ color: "var(--text-muted)", opacity: 0.4 }}>|</span>
          <button
            type="button"
            onClick={clear}
            disabled={selected.length === 0}
            className="text-[11px] disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="max-h-[280px] overflow-y-auto scroll-thin">
        {months.length === 0 && (
          <div className="px-3 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
            No months available.
          </div>
        )}
        {months.map((ym) => {
          const wsAll = monthWeeks.get(ym) ?? [];
          const ws = wsAll.filter(isAvailable);
          const ticked = ws.filter((w) => selectedSet.has(w)).length;
          const all = ws.length;
          const state: "none" | "partial" | "all" =
            all === 0 || ticked === 0
              ? "none"
              : ticked === all
                ? "all"
                : "partial";
          const isExpanded = expanded.has(ym);
          return (
            <div
              key={ym}
              style={{ borderBottom: "1px solid var(--border-card)" }}
              className="last:border-b-0"
            >
              <div
                className="flex items-center gap-2 px-3 py-1.5 transition-colors"
                style={{ background: "var(--bg-card)" }}
              >
                <Box
                  state={state}
                  disabled={all === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMonth(ym);
                  }}
                />
                <button
                  type="button"
                  onClick={() => toggleExpanded(ym)}
                  className="flex-1 flex items-center justify-between text-left"
                >
                  <span
                    className="text-[12.5px] font-semibold"
                    style={{ color: all === 0 ? "var(--text-muted)" : "var(--text-primary)" }}
                  >
                    {formatMonthYear(ym)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className="text-[11px] tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {ticked} / {all}
                    </span>
                    <CaretIcon
                      className="h-3 w-3 transition-transform"
                      style={{
                        color: "var(--text-muted)",
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                    />
                  </span>
                </button>
              </div>
              {isExpanded && (
                <ul className="pl-9 pr-3 pb-1.5">
                  {wsAll.map((w) => {
                    const checked = selectedSet.has(w);
                    const avail = isAvailable(w);
                    const coverage = avail ? daysWithDataInWeek(w) : 0;
                    const isPartial = avail && coverage > 0 && coverage < 7;
                    return (
                      <li
                        key={w}
                        className="flex items-center gap-2 py-0.5 rounded px-1"
                        style={{
                          cursor: avail ? "pointer" : "not-allowed",
                          opacity: avail ? 1 : 0.4,
                        }}
                        onClick={() => avail && toggleWeek(w)}
                        title={
                          !avail
                            ? "No data in this week"
                            : isPartial
                              ? `Data available for ${coverage} of 7 days`
                              : undefined
                        }
                      >
                        <Box
                          state={checked ? "all" : "none"}
                          small
                          disabled={!avail}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (avail) toggleWeek(w);
                          }}
                        />
                        <span
                          className="text-[12px] tabular-nums min-w-[58px]"
                          style={{ color: avail ? "var(--text-primary)" : "var(--text-muted)" }}
                        >
                          Week {weekNumber(w)}
                        </span>
                        <span
                          className="text-[11.5px] flex-1"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {formatWeekRange(w)}
                        </span>
                        {isPartial && (
                          <span
                            className="text-[9.5px] tabular-nums font-semibold px-1.5 py-[1px] rounded shrink-0"
                            style={{
                              color: "var(--warning, #d97706)",
                              background: "rgba(217,119,6,0.1)",
                            }}
                            aria-label={`Partial data: ${coverage} of 7 days`}
                          >
                            {coverage}/7
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/*  Daily mode body — accordion of months × calendar grid           */
/* ---------------------------------------------------------------- */

function DailyAccordion({
  months,
  selected,
  availableDays,
  onChange,
}: {
  months: string[];
  selected: string[];
  availableDays: Set<string>;
  onChange: (next: string[]) => void;
}) {
  const monthDays = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ym of months) out.set(ym, daysInMonth(ym));
    return out;
  }, [months]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const treatAllAvailable = availableDays.size === 0;
  const isAvailable = (d: string) =>
    treatAllAvailable || availableDays.has(d);
  const [anchor, setAnchor] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (months.length > 0) s.add(months[0]);
    return s;
  });
  function toggleExpanded(ym: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym);
      else next.add(ym);
      return next;
    });
  }

  const totalAvailable = useMemo(() => {
    let n = 0;
    for (const ds of Array.from(monthDays.values())) {
      for (const d of ds) if (isAvailable(d)) n++;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDays, availableDays]);

  function commit(next: Iterable<string>) {
    onChange(Array.from(next).sort());
  }

  function handleDayClick(day: string, e: React.MouseEvent) {
    if (!isAvailable(day)) return;
    if (e.shiftKey && anchor) {
      const next = new Set(selected);
      const a = anchor < day ? anchor : day;
      const b = anchor < day ? day : anchor;
      const startR = dayDateRange(a);
      const endR = dayDateRange(b);
      if (startR && endR) {
        const cur = new Date(startR.start);
        while (cur.getTime() <= endR.start.getTime()) {
          const iso = isoDate(cur);
          if (isAvailable(iso)) next.add(iso);
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }
      commit(next);
      return;
    }
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setAnchor(day);
    commit(next);
  }

  function toggleMonth(ym: string) {
    const ds = (monthDays.get(ym) ?? []).filter(isAvailable);
    if (ds.length === 0) return;
    const allTicked = ds.every((d) => selectedSet.has(d));
    const next = new Set(selected);
    if (allTicked) for (const d of ds) next.delete(d);
    else for (const d of ds) next.add(d);
    commit(next);
  }
  function selectAll() {
    const all = new Set<string>();
    for (const ds of Array.from(monthDays.values())) {
      for (const d of ds) if (isAvailable(d)) all.add(d);
    }
    commit(all);
  }
  function clear() {
    onChange([]);
    setAnchor(null);
  }

  return (
    <>
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5"
        style={{
          borderBottom: "1px solid var(--border-card)",
          background: "var(--bg-card)",
        }}
      >
        <div
          className="text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          Days
          <span
            className="ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-[1px] text-[9px] font-semibold tabular-nums"
            style={{
              background: "var(--accent-subtle)",
              color: "var(--accent)",
            }}
          >
            {selected.length}
            <span className="opacity-60 mx-0.5">/</span>
            {totalAvailable}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            disabled={selected.length === totalAvailable}
            className="text-[11px] disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            Select all
          </button>
          <span style={{ color: "var(--text-muted)", opacity: 0.4 }}>|</span>
          <button
            type="button"
            onClick={clear}
            disabled={selected.length === 0}
            className="text-[11px] disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            Clear
          </button>
        </div>
      </div>
      <div
        className="px-3 py-1 text-[10px]"
        style={{
          color: "var(--text-muted)",
          background: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border-card)",
        }}
      >
        Click a day to toggle · <span className="font-semibold">Shift</span>+click for range
      </div>
      <div className="max-h-[320px] overflow-y-auto scroll-thin">
        {months.length === 0 && (
          <div className="px-3 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
            No months available.
          </div>
        )}
        {months.map((ym) => {
          const dsAll = monthDays.get(ym) ?? [];
          const ds = dsAll.filter(isAvailable);
          const ticked = ds.filter((d) => selectedSet.has(d)).length;
          const all = ds.length;
          const state: "none" | "partial" | "all" =
            all === 0 || ticked === 0
              ? "none"
              : ticked === all
                ? "all"
                : "partial";
          const isExpanded = expanded.has(ym);
          return (
            <div
              key={ym}
              style={{ borderBottom: "1px solid var(--border-card)" }}
              className="last:border-b-0"
            >
              <div
                className="flex items-center gap-2 px-3 py-1.5 transition-colors"
                style={{ background: "var(--bg-card)" }}
              >
                <Box
                  state={state}
                  disabled={all === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMonth(ym);
                  }}
                />
                <button
                  type="button"
                  onClick={() => toggleExpanded(ym)}
                  className="flex-1 flex items-center justify-between text-left"
                >
                  <span
                    className="text-[12.5px] font-semibold"
                    style={{ color: all === 0 ? "var(--text-muted)" : "var(--text-primary)" }}
                  >
                    {formatMonthYear(ym)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className="text-[11px] tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {ticked} / {all}
                    </span>
                    <CaretIcon
                      className="h-3 w-3 transition-transform"
                      style={{
                        color: "var(--text-muted)",
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                    />
                  </span>
                </button>
              </div>
              {isExpanded && (
                <CalendarGrid
                  days={dsAll}
                  anchor={anchor}
                  selectedSet={selectedSet}
                  isAvailable={isAvailable}
                  onClickDay={handleDayClick}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function CalendarGrid({
  days,
  anchor,
  selectedSet,
  isAvailable,
  onClickDay,
}: {
  days: string[];
  anchor: string | null;
  selectedSet: Set<string>;
  isAvailable: (day: string) => boolean;
  onClickDay: (day: string, e: React.MouseEvent) => void;
}) {
  if (days.length === 0) return null;
  const leadIn = dayOfWeekMonFirst(days[0]);
  const cells: Array<string | null> = [];
  for (let i = 0; i < leadIn; i++) cells.push(null);
  for (const d of days) cells.push(d);

  return (
    <div className="px-3 pb-2.5 pt-1">
      <div
        className="grid grid-cols-7 gap-1 text-[9.5px] font-semibold text-center mb-1 uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        <span>Mo</span>
        <span>Tu</span>
        <span>We</span>
        <span>Th</span>
        <span>Fr</span>
        <span>Sa</span>
        <span>Su</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`pad-${i}`} className="h-7" />;
          const dayNum = Number(d.slice(8, 10));
          const checked = selectedSet.has(d);
          const isAnchor = d === anchor;
          const avail = isAvailable(d);
          if (!avail) {
            return (
              <span
                key={d}
                title="No data on this day"
                className="h-7 inline-flex items-center justify-center text-[11px] tabular-nums cursor-not-allowed select-none"
                style={{ color: "var(--text-muted)", opacity: 0.4 }}
              >
                {dayNum}
              </span>
            );
          }
          return (
            <button
              key={d}
              type="button"
              onClick={(e) => onClickDay(d, e)}
              title={d}
              className="h-7 text-[11px] font-medium rounded transition-colors tabular-nums relative"
              style={{
                background: checked ? "var(--accent)" : undefined,
                color: checked ? "#fff" : "var(--text-primary)",
                outline: isAnchor && !checked ? "1px solid var(--accent)" : undefined,
              }}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Tiny pieces                                                     */
/* ---------------------------------------------------------------- */

function formatDayLabel(day: string): string {
  const r = dayDateRange(day);
  if (!r) return day;
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${MONTHS[r.start.getUTCMonth()]} ${r.start.getUTCDate()}, ${r.start.getUTCFullYear()}`;
}

function Box({
  state,
  small,
  disabled,
  onClick,
}: {
  state: "none" | "partial" | "all";
  small?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const size = small ? 13 : 14;
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      if (onClick) onClick(e);
    },
    [onClick, disabled]
  );
  return (
    <span
      role="checkbox"
      aria-checked={state === "all"}
      aria-disabled={disabled || undefined}
      onClick={handleClick}
      className="inline-flex shrink-0 items-center justify-center rounded transition-colors"
      style={{
        width: size,
        height: size,
        background: state === "none" ? "var(--bg-elevated)" : "var(--accent)",
        border: state === "none" ? "1px solid var(--border-card)" : "1px solid var(--accent)",
        color: state !== "none" ? "#fff" : undefined,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : undefined,
      }}
    >
      {state === "all" && (
        <svg viewBox="0 0 12 12" width={size - 2} height={size - 2}>
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
      {state === "partial" && (
        <svg viewBox="0 0 12 12" width={size - 2} height={size - 2}>
          <path
            d="M3 6h6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}

function CalendarIcon({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.6" />
      <path d="M2.5 6.5h11M6 2v3M10 2v3" />
    </svg>
  );
}

function CaretIcon({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}
