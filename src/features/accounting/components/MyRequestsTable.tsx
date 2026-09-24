"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { Download, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  ColumnToggleMenu,
  type ColumnToggleOption,
} from "@/features/travel-booking/components/ColumnToggleMenu";
import type { ReportRow } from "@/lib/acc/report-service";
import {
  cellExportValue,
  cellText,
  columnsForKind,
  daysPending,
  daysUntilPayment,
  defaultVisibleKeys,
  isSettled,
  statusDisplay,
  type MyRequestColKey,
  type MyRequestColumn,
  type MyRequestKind,
  type MyRequestStatusDisplay,
} from "@/lib/acc/my-request-view";
import { MyRequestStatusChip } from "@/features/accounting/components/MyRequestStatusChip";

/**
 * **The table half of My Requests and My Work.**
 *
 * Every rule about *which* columns exist, what they are called and what each
 * cell says lives in `@/lib/acc/my-request-view` — pure and unit-tested. This
 * file is the rendering, and it must not recompute a cell: the export and the
 * screen read the same functions, because two renderers of one figure drift and
 * the reader has no way to tell which one is lying.
 *
 * The list view is unchanged and still the default. This is an alternative
 * shape for the same rows, the same filters and the same click target — a row
 * opens the same drawer, so nothing about the table is a second way to do
 * anything.
 */

/** Per page, so somebody's My Work layout is not somebody else's My Requests. */
function storageKey(kind: MyRequestKind, part: "cols" | "order"): string {
  return `form-portal-myreq-${part}-${kind}`;
}

/**
 * Read a persisted layout, ignoring anything that no longer matches the code.
 *
 * A stored key that has since been removed, or a stored list missing a column
 * that has since been added, must not decide the layout — the first would be a
 * checkbox for a column that cannot render and the second would hide a new
 * column from everybody who has ever opened the page. So the stored value is
 * a *filter over today's list*, never a replacement for it.
 */
function readStored<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private window, or storage the browser has blocked. The layout is a
    // convenience; losing it costs a reader two clicks and nothing else.
  }
}

/**
 * Forget a stored layout entirely, rather than storing today's defaults over
 * it — see `handleResetColumns`. Same swallowed failure as `writeStored`,
 * and for the same reason.
 */
function clearStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do: the state is already reset in memory.
  }
}

export function MyRequestsTable({
  rows,
  exportRows,
  kind,
  onOpen,
  statusFor,
}: {
  /** The page on screen. */
  rows: ReportRow[];
  /**
   * What Excel gets: **every filtered row, not just this page.**
   *
   * Somebody who has filtered to 57 claims and is looking at the first ten
   * expects the file to hold 57 — the page is how the screen copes with the
   * result, not part of the question they asked. The COLUMNS still follow the
   * screen exactly, because those are a choice they made.
   */
  exportRows: ReportRow[];
  kind: MyRequestKind;
  /** Same target as the list: a row opens the same drawer. */
  onOpen: (row: ReportRow) => void;
  /**
   * How to label a row's status — **passed in so the table cannot disagree
   * with the list beside it**.
   *
   * งานของฉัน labels a row by what it means to the VIEWER
   * (`getMyWorkStatusBucket`: a request you have already signed reads Complete
   * even while accounting still holds it), and คำขอของฉัน labels it by the
   * request's own status. Reading `row.status` here would have made the table
   * answer the other page's question on My Work.
   */
  statusFor?: (row: ReportRow) => MyRequestStatusDisplay;
}) {
  const allColumns = useMemo(() => columnsForKind(kind), [kind]);

  const [order, setOrder] = useState<MyRequestColKey[]>(() =>
    allColumns.map((c) => c.key),
  );
  const [visible, setVisible] = useState<Record<MyRequestColKey, boolean>>(() => {
    const defaults = defaultVisibleKeys(kind);
    const out = {} as Record<MyRequestColKey, boolean>;
    for (const c of allColumns) out[c.key] = defaults.indexOf(c.key) !== -1;
    return out;
  });

  /* Read after mount, not in the initial state: localStorage does not exist on
     the server, and seeding state from it would make the first client render
     disagree with the server's and hydrate wrong. */
  useEffect(() => {
    const storedCols = readStored<Record<string, boolean>>(storageKey(kind, "cols"));
    if (storedCols) {
      setVisible((prev) => {
        const next = { ...prev };
        for (const c of allColumns) {
          // A column absent from the stored map is one added since it was
          // written — it keeps today's default rather than defaulting to off.
          if (typeof storedCols[c.key] === "boolean") next[c.key] = storedCols[c.key];
        }
        return next;
      });
    }
    const storedOrder = readStored<string[]>(storageKey(kind, "order"));
    if (storedOrder) {
      const known = allColumns.map((c) => c.key);
      const kept = storedOrder.filter((k): k is MyRequestColKey =>
        known.indexOf(k as MyRequestColKey) !== -1,
      );
      // Anything the stored order never knew about goes on the end, in
      // declaration order, so a new column appears rather than disappearing.
      const missing = known.filter((k) => kept.indexOf(k) === -1);
      setOrder([...kept, ...missing]);
    }
  }, [kind, allColumns]);

  const byKey = useMemo(() => {
    const m = new Map<MyRequestColKey, MyRequestColumn>();
    for (const c of allColumns) m.set(c.key, c);
    return m;
  }, [allColumns]);

  const orderedColumns = useMemo(
    () => order.map((k) => byKey.get(k)).filter((c): c is MyRequestColumn => !!c),
    [order, byKey],
  );

  const shownColumns = useMemo(
    () => orderedColumns.filter((c) => visible[c.key]),
    [orderedColumns, visible],
  );

  const toggleOptions: ColumnToggleOption<MyRequestColKey>[] = useMemo(
    () => orderedColumns.map((c) => ({ key: c.key, label: c.label })),
    [orderedColumns],
  );

  const handleVisibleChange = useCallback(
    (next: Record<MyRequestColKey, boolean>) => {
      setVisible(next);
      writeStored(storageKey(kind, "cols"), next);
    },
    [kind],
  );

  const handleReorder = useCallback(
    (keys: MyRequestColKey[]) => {
      setOrder(keys);
      writeStored(storageKey(kind, "order"), keys);
    },
    [kind],
  );

  /**
   * Back to the standard table (the user, 2026-09-24).
   *
   * The columns each page opens on are a **standard**, not merely a first
   * guess: somebody who explores the picker and loses track of what was there
   * has no way back otherwise, because the layout persists — and it persists
   * per browser, so "log out and in again" does not undo it either.
   *
   * It restores the order as well as the visibility, and **clears the stored
   * layout rather than storing the defaults**: a viewer who has never touched
   * the picker and one who has just reset are in the same state, so a later
   * change to `defaultVisibleKeys` reaches both. Writing the defaults down
   * would freeze today's answer into that browser for ever.
   */
  /**
   * True when nothing has been changed from the standard.
   *
   * Compared against the CURRENT defaults rather than against a stored flag,
   * so a change to `defaultVisibleKeys` moves the button rather than leaving
   * it offering to restore a layout that is already on screen.
   */
  const isStandardLayout = useMemo(() => {
    const defaults = defaultVisibleKeys(kind);
    for (const c of allColumns) {
      if (!!visible[c.key] !== (defaults.indexOf(c.key) !== -1)) return false;
    }
    return allColumns.every((c, i) => order[i] === c.key);
  }, [kind, allColumns, visible, order]);

  const handleResetColumns = useCallback(() => {
    const defaults = defaultVisibleKeys(kind);
    const next = {} as Record<MyRequestColKey, boolean>;
    for (const c of allColumns) next[c.key] = defaults.indexOf(c.key) !== -1;
    setVisible(next);
    setOrder(allColumns.map((c) => c.key));
    clearStored(storageKey(kind, "cols"));
    clearStored(storageKey(kind, "order"));
  }, [kind, allColumns]);

  /**
   * ONE clock for the whole render.
   *
   * Every day-count column measures against it, so two rows of one table cannot
   * be measured a millisecond apart — and the export writes the same numbers
   * the reader was looking at when they pressed the button.
   */
  const nowIso = useMemo(() => new Date().toISOString(), [rows]);

  const statusOf = useCallback(
    (row: ReportRow) => statusFor?.(row) ?? statusDisplay(row.status),
    [statusFor],
  );

  function handleExport() {
    if (exportRows.length === 0) {
      toast.error("ไม่มีรายการให้ export");
      return;
    }
    // Exactly the columns on screen, in the order they are on screen. An export
    // that quietly widened to every column would not be the table somebody is
    // looking at, which is the thing they pressed the button to keep.
    const header = shownColumns.map((c) => c.label);
    const body = exportRows.map((r) =>
      shownColumns.map((c) =>
        // Status alone comes from `statusOf`, for the reason its prop gives:
        // `cellExportValue` reads the row's own status, which is the wrong
        // question on My Work — and an export that disagrees with the screen
        // it was taken from is worse than no export.
        c.key === "status" ? statusOf(r).label : cellExportValue(r, c.key, nowIso),
      ),
    );
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = shownColumns.map((c) => ({ wch: c.key === "workDetail" ? 40 : 18 }));
    for (let i = 0; i < header.length; i++) {
      const ref = XLSX.utils.encode_cell({ r: 0, c: i });
      const cell = ws[ref];
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "4C74C4" } },
          alignment: { horizontal: "center", vertical: "center" },
        };
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, kind === "work" ? "My Work" : "My Request");
    const stamp = new Date();
    const name = `${kind === "work" ? "my-work" : "my-request"}-${stamp.getFullYear()}${String(
      stamp.getMonth() + 1,
    ).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}.xlsx`;
    XLSX.writeFile(wb, name);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <ColumnToggleMenu
          columns={toggleOptions}
          visible={visible}
          onChange={handleVisibleChange}
          onReorder={handleReorder}
        />
        {/* Shown only once the layout differs from the standard: a reset
            button beside an untouched table is a control that can do
            nothing, and it is the picker that tells you a layout is yours. */}
        {!isStandardLayout && (
          <button
            type="button"
            onClick={handleResetColumns}
            title="กลับไปใช้คอลัมน์มาตรฐานของหน้านี้"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border-none cursor-pointer"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
          >
            <RotateCcw size={13} /> คอลัมน์มาตรฐาน
          </button>
        )}
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border-none cursor-pointer"
          style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
        >
          <Download size={13} />
          Excel
        </button>
      </div>

      {/* The table scrolls rather than wrapping: a column of dates that wraps
          stops being scannable, which is the whole reason for this view.

          `show-x-scroll` is not decoration — `.acc-theme` hides every
          scrollbar (globals.css), so the table scrolled with nothing on screen
          saying it could. That class is the existing opt-in, added for AP-3's
          expense grid, and reusing it keeps one definition of what a visible
          horizontal scrollbar looks like in this app. */}
      <div
        className="overflow-x-auto show-x-scroll rounded-xl"
        style={{ border: "1px solid var(--border-card)" }}
      >
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr style={{ background: "var(--bg-card-header)" }}>
              {shownColumns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 font-bold whitespace-nowrap"
                  style={{
                    color: "var(--text-heading)",
                    textAlign: col.align === "right" ? "right" : "left",
                    borderBottom: "1px solid var(--border-card)",
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.environment ?? "P"}-${row.id}`}
                onClick={() => onOpen(row)}
                className="cursor-pointer transition-colors"
                style={{ borderBottom: "1px solid var(--border-light)" }}
              >
                {shownColumns.map((col) => (
                  <td
                    key={col.key}
                    className={
                      col.key === "workDetail"
                        ? "px-3 py-2 max-w-[280px] truncate"
                        : "px-3 py-2 whitespace-nowrap"
                    }
                    style={{
                      color: cellTone(row, col.key, nowIso),
                      textAlign: col.align === "right" ? "right" : "left",
                      fontVariantNumeric: col.align === "right" ? "tabular-nums" : undefined,
                      fontWeight: col.key === "requestNo" || col.key === "totalAmount" ? 700 : 400,
                    }}
                    title={cellTitle(row, col.key, nowIso)}
                  >
                    {col.key === "status" ? (
                      <MyRequestStatusChip display={statusOf(row)} />
                    ) : (
                      cellText(row, col.key, nowIso)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The tooltip, where a cell had to drop something to stay scannable.
 *
 * รออนุมัติโดย shows a name or a department and never an email address — so
 * the address, which is the only thing naming the person when HR has no row
 * for them, lives here rather than being lost.
 */
function cellTitle(row: ReportRow, key: MyRequestColKey, nowIso: string): string | undefined {
  if (key === "workDetail") return cellText(row, key, nowIso);
  if (key === "pendingBy") return row.pendingApproverEmail?.trim() || undefined;
  return undefined;
}

/**
 * Colour is used for exactly two things, and both are "look at this row".
 *
 * A payment date already past on a claim nobody has settled, and a request that
 * has sat for a fortnight. Everything else is body text: a table where several
 * columns compete for attention has none.
 *
 * `nowIso` is the render's own clock, passed rather than read: calling
 * `new Date()` per cell would measure the rows of one table against different
 * instants, and could colour a row the cell beside it disagrees with.
 */
function cellTone(row: ReportRow, key: MyRequestColKey, nowIso: string): string {
  if (key === "daysUntilPayment" && !isSettled(row.status)) {
    const d = daysUntilPayment(row, nowIso);
    if (d != null && d < 0) return "var(--text-danger)";
  }
  if (key === "daysPending") {
    const d = daysPending(row, nowIso);
    if (d != null && d >= 14) return "var(--text-danger)";
    if (d != null && d >= 7) return "var(--text-warning)";
  }
  if (key === "requestNo") return "var(--text-heading)";
  if (key === "totalAmount") return "var(--color-action)";
  return "var(--text-secondary)";
}
