"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type GroupingState,
  type ExpandedState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight, ChevronsUpDown, ArrowUp, ArrowDown, Search, ChevronsDownUp, ChevronsDown, Mail, Loader2, Download, Columns3, X, Layers, Clock, FolderOpen, CalendarClock } from "lucide-react";
import * as XLSX from "xlsx-js-style";

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  groupBy?: string[];
  enableGlobalFilter?: boolean;
  pageSize?: number;
  reportName?: string;
  emptyState?: React.ReactNode;
}

export function DataTable<T>({
  data,
  columns,
  groupBy: initialGroupBy,
  enableGlobalFilter = true,
  pageSize = 100,
  reportName,
  emptyState,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [grouping, setGrouping] = useState<GroupingState>(initialGroupBy ?? []);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [globalFilter, setGlobalFilter] = useState("");
  const [page, setPage] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<"idle" | "sent" | "error">("idle");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const [scheduleConfig, setScheduleConfig] = useState({
    frequency: "daily" as "daily" | "weekly" | "monthly",
    time: "08:00",
    dayOfWeek: "1",
    dayOfMonth: "1",
    sharedDrivePath: "RPC_$Central Data/FastReports",
    emailNotify: true,
    dateRange: "yesterday" as "yesterday" | "thisWeek" | "lastWeek" | "mtd",
  });

  // Skip effects on first mount
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);

  // Reset page when data changes (skip first mount)
  const prevDataLen = useRef(data.length);
  useEffect(() => {
    if (!mounted.current) return;
    if (data.length !== prevDataLen.current) {
      setPage(0);
      prevDataLen.current = data.length;
    }
  }, [data.length]);

  // Sync grouping when initialGroupBy prop changes
  const prevGroupBy = useRef(initialGroupBy);
  useEffect(() => {
    if (!mounted.current) return;
    if (JSON.stringify(initialGroupBy) !== JSON.stringify(prevGroupBy.current)) {
      setGrouping(initialGroupBy ?? []);
      setExpanded(true);
      prevGroupBy.current = initialGroupBy;
    }
  }, [initialGroupBy]);

  // Identify numeric columns (aggregationFn === "sum")
  const numericColKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const c of columns) {
      if ("aggregationFn" in c && c.aggregationFn === "sum" && "accessorKey" in c) {
        keys.add(String(c.accessorKey));
      }
    }
    return keys;
  }, [columns]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, grouping, expanded, globalFilter, columnVisibility },
    onSortingChange: (updater) => { setSorting(updater); setPage(0); },
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const totalPages = Math.ceil(rows.length / pageSize);
  const pagedRows = useMemo(() => rows.slice(page * pageSize, (page + 1) * pageSize), [rows, page, pageSize]);

  // Groupable columns
  const groupableColumns = useMemo(
    () => columns.filter((c) => "accessorKey" in c && c.enableGrouping !== false).map((c) => ({
      id: ("accessorKey" in c ? String(c.accessorKey) : c.id) ?? "",
      label: (typeof c.header === "string" ? c.header : ("accessorKey" in c ? String(c.accessorKey) : "")) ?? "",
    })),
    [columns],
  );

  // Column headers for Excel export
  const colHeaders = useMemo(
    () => columns.map((c) => ({
      key: ("accessorKey" in c ? String(c.accessorKey) : c.id) ?? "",
      label: (typeof c.header === "string" ? c.header : ("accessorKey" in c ? String(c.accessorKey) : "")) ?? "",
    })),
    [columns],
  );

  // Shared Excel workbook builder — flat raw data export
  const buildExcelWorkbook = () => {
    const filteredRows = table.getFilteredRowModel().rows;
    const leafRows = filteredRows.filter((r) => !r.getIsGrouped());
    const sourceRows = leafRows.length > 0 ? leafRows.map((r) => r.original) : data;

    const sheetData = sourceRows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const col of colHeaders) {
        obj[col.label] = (row as Record<string, unknown>)[col.key];
      }
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (reportName ?? "Data").slice(0, 31));
    return wb;
  };

  const excelFileName = () => {
    const datePart = new Date().toISOString().slice(0, 10);
    return `${(reportName ?? "Report").replace(/\s+/g, "_")}_${datePart}.xlsx`;
  };

  // Download Excel locally
  const handleDownload = () => {
    if (data.length === 0) return;
    const wb = buildExcelWorkbook();
    XLSX.writeFile(wb, excelFileName());
  };

  // Send Excel via email
  const handleSendEmail = async () => {
    if (sending || data.length === 0) return;
    setSending(true);
    setSendStatus("idle");
    try {
      const wb = buildExcelWorkbook();
      const buf = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      const fileName = excelFileName();

      const res = await fetch("/api/intelligence/reports/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportName: reportName ?? "Report", fileName, excelBase64: buf }),
      });
      const json = await res.json();
      if (json.ok) {
        setSendStatus("sent");
        setTimeout(() => setSendStatus("idle"), 3000);
      } else {
        setSendStatus("error");
        setTimeout(() => setSendStatus("idle"), 3000);
      }
    } catch {
      setSendStatus("error");
      setTimeout(() => setSendStatus("idle"), 3000);
    } finally {
      setSending(false);
    }
  };

  // Footer totals — sum numeric columns, filtered by global search
  const footerTotals = useMemo(() => {
    if (data.length === 0) return null;
    const sumCols = columns.filter((c) => "aggregationFn" in c && c.aggregationFn === "sum" && "accessorKey" in c);
    if (sumCols.length === 0) return null;

    const totals: Record<string, number> = {};
    for (const col of sumCols) {
      const key = String(("accessorKey" in col ? col.accessorKey : col.id) ?? "");
      totals[key] = 0;
    }

    // When global filter is active, only sum matching rows
    const searchLower = globalFilter.toLowerCase();
    const sourceRows = searchLower
      ? data.filter((row) => {
          const vals = Object.values(row as Record<string, unknown>);
          return vals.some((v) => String(v ?? "").toLowerCase().includes(searchLower));
        })
      : data;

    for (const row of sourceRows) {
      for (const key of Object.keys(totals)) {
        const v = (row as Record<string, unknown>)[key];
        totals[key] += typeof v === "number" ? v : 0;
      }
    }
    return totals;
  }, [data, columns, globalFilter]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap shrink-0">
        {/* Global search */}
        {enableGlobalFilter && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
            <Search size={13} style={{ color: "var(--text-muted)" }} />
            <input
              value={globalFilter}
              onChange={(e) => { setGlobalFilter(e.target.value); setPage(0); }}
              placeholder="Search..."
              className="text-[12px] outline-none bg-transparent"
              style={{ color: "var(--text-primary)", width: 160 }}
            />
          </div>
        )}

        {/* Group by — dropdown with checkboxes */}
        <div className="relative">
          <button
            onClick={() => setShowGroupPicker((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg cursor-pointer border-none transition-colors"
            style={{
              background: grouping.length > 0 ? "var(--nav-active-bg)" : "var(--bg-badge)",
              color: grouping.length > 0 ? "var(--nav-active-text)" : "var(--text-secondary)",
            }}
          >
            <Layers size={12} />
            {grouping.length === 0
              ? "Group by"
              : grouping.map((gId) => groupableColumns.find((c) => c.id === gId)?.label ?? gId).join(" › ")}
            {grouping.length > 0 && (
              <span
                className="ml-0.5 cursor-pointer flex items-center"
                onClick={(e) => { e.stopPropagation(); setGrouping([]); setExpanded(true); setPage(0); }}
                title="Clear groups"
              >
                <X size={10} />
              </span>
            )}
          </button>
          {showGroupPicker && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowGroupPicker(false)} />
              <div
                className="absolute top-full left-0 mt-1 z-30 rounded-xl p-2 min-w-[180px] shadow-lg"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <button
                  onClick={() => { setGrouping([]); setExpanded(true); setPage(0); setShowGroupPicker(false); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer border-none text-[11px] mb-1"
                  style={{
                    background: grouping.length === 0 ? "var(--nav-active-bg)" : "transparent",
                    color: grouping.length === 0 ? "var(--nav-active-text)" : "var(--text-muted)",
                  }}
                >
                  None
                </button>
                <div style={{ borderBottom: "1px solid var(--border-light)", marginBottom: 4 }} />
                {groupableColumns.map((c) => {
                  const active = grouping.includes(c.id);
                  const idx = grouping.indexOf(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[11px]"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => {
                          setGrouping((prev) =>
                            prev.includes(c.id) ? prev.filter((g) => g !== c.id) : [...prev, c.id]
                          );
                          setExpanded(true);
                          setPage(0);
                        }}
                        className="rounded"
                      />
                      <span className="flex-1">{c.label}</span>
                      {active && (
                        <span
                          className="text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                        >
                          {idx + 1}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Row count */}
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {rows.length.toLocaleString()} rows
        </span>

        {/* Collapse / Expand all */}
        {grouping.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer border-none transition-colors"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
              title="Expand all groups"
            >
              <ChevronsDown size={12} /> Expand
            </button>
            <button
              onClick={() => setExpanded({})}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer border-none transition-colors"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
              title="Collapse all groups"
            >
              <ChevronsDownUp size={12} /> Collapse
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Column visibility */}
        <div className="relative">
          <button
            onClick={() => setShowColumnPicker((v) => !v)}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer border-none transition-colors"
            style={{ background: showColumnPicker ? "var(--nav-active-bg)" : "var(--bg-badge)", color: showColumnPicker ? "var(--nav-active-text)" : "var(--text-secondary)" }}
            title="Show/hide columns"
          >
            <Columns3 size={12} /> Columns
          </button>
          {showColumnPicker && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowColumnPicker(false)} />
              <div
                className="absolute top-full right-0 mt-1 z-30 rounded-xl p-2 min-w-[180px] shadow-lg"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                {table.getAllLeafColumns().map((col) => {
                  const label = typeof col.columnDef.header === "string" ? col.columnDef.header : col.id;
                  return (
                    <label
                      key={col.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[11px]"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <input
                        type="checkbox"
                        checked={col.getIsVisible()}
                        onChange={col.getToggleVisibilityHandler()}
                        className="rounded"
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Export actions */}
        {reportName && data.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer border-none transition-colors"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
              title="Download Excel"
            >
              <Download size={12} /> Excel
            </button>
            <button
              onClick={handleSendEmail}
              disabled={sending}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer border-none transition-colors disabled:opacity-50"
              style={{
                background: sendStatus === "sent" ? "#16a34a" : sendStatus === "error" ? "#dc2626" : "var(--bg-badge)",
                color: sendStatus === "sent" || sendStatus === "error" ? "#fff" : "var(--text-secondary)",
              }}
              title="Send Excel to your email"
            >
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
              {sending ? "Sending..." : sendStatus === "sent" ? "Sent!" : sendStatus === "error" ? "Failed" : "Email"}
            </button>
            <button
              onClick={() => setShowSchedule(true)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg cursor-pointer border-none transition-colors"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
              title="Schedule auto-export to Shared Drive"
            >
              <CalendarClock size={12} /> Schedule
            </button>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-[11px] px-2 py-1 rounded cursor-pointer border-none disabled:opacity-30"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
            >
              Prev
            </button>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-[11px] px-2 py-1 rounded cursor-pointer border-none disabled:opacity-30"
              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div ref={tableRef} className="rounded-xl overflow-hidden flex-1 min-h-0" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div className="overflow-auto h-full">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10" style={{ background: "var(--bg-card)" }}>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} style={{ borderBottom: "2px solid var(--border-main)" }}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      onClick={header.column.getToggleSortingHandler()}
                      className="px-3 py-2 font-bold select-none"
                      style={{
                        color: "var(--text-muted)",
                        cursor: header.column.getCanSort() ? "pointer" : "default",
                        textAlign: numericColKeys.has(header.column.id) ? "right" : "left",
                      }}
                    >
                      <div className="flex items-center gap-1" style={{ justifyContent: numericColKeys.has(header.column.id) ? "flex-end" : "flex-start" }}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === "asc" ? (
                          <ArrowUp size={11} />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDown size={11} />
                        ) : header.column.getCanSort() ? (
                          <ChevronsUpDown size={11} style={{ opacity: 0.3 }} />
                        ) : null}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {pagedRows.map((row, i) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                  style={{
                    borderBottom: "1px solid var(--border-light)",
                    background: row.getIsGrouped()
                      ? "var(--bg-card-alt)"
                      : i % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const isNumeric = numericColKeys.has(cell.column.id);
                    return (
                      <td
                        key={cell.id}
                        className="px-3 py-2"
                        style={{
                          color: cell.getIsGrouped() ? "var(--text-heading)" : cell.getIsPlaceholder() ? "transparent" : "var(--text-primary)",
                          fontWeight: cell.getIsGrouped() ? 700 : undefined,
                          textAlign: isNumeric ? "right" : "left",
                        }}
                      >
                        {cell.getIsGrouped() ? (() => {
                          // Compute sparkline % for the primary numeric column
                          const firstNumKey = Array.from(numericColKeys)[0];
                          const groupTotal = firstNumKey && footerTotals?.[firstNumKey]
                            ? row.subRows.reduce((s, r) => s + (typeof (r.original as Record<string, unknown>)[firstNumKey] === "number" ? (r.original as Record<string, unknown>)[firstNumKey] as number : 0), 0)
                            : 0;
                          const grandTotal = firstNumKey && footerTotals?.[firstNumKey] ? footerTotals[firstNumKey] : 0;
                          const pct = grandTotal > 0 ? Math.round((groupTotal / grandTotal) * 100) : 0;
                          return (
                            <button
                              onClick={row.getToggleExpandedHandler()}
                              className="flex items-center gap-1.5 cursor-pointer bg-transparent border-none p-0 w-full"
                              style={{ color: "inherit", font: "inherit", paddingLeft: `${row.depth * 16}px` }}
                            >
                              {row.getIsExpanded() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              <span className="text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
                                ({row.subRows.length})
                              </span>
                              {pct > 0 && row.depth === 0 && (
                                <span className="inline-flex items-center gap-1 ml-auto">
                                  <span className="inline-block h-1.5 rounded-full" style={{ width: `${Math.max(pct * 0.6, 4)}px`, background: "var(--nav-active-text)", opacity: 0.5 }} />
                                  <span className="text-[9px] font-normal" style={{ color: "var(--text-faint)" }}>{pct}%</span>
                                </span>
                              )}
                            </button>
                          );
                        })() : cell.getIsAggregated() ? (
                          flexRender(cell.column.columnDef.aggregatedCell ?? cell.column.columnDef.cell, cell.getContext())
                        ) : cell.getIsPlaceholder() ? null : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {pagedRows.length === 0 && (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length}>
                    {emptyState ?? (
                      <p className="px-3 py-8 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>No data found</p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            {footerTotals && (
              <tfoot className="sticky bottom-0 z-10" style={{ background: "var(--bg-card)" }}>
                <tr style={{ borderTop: "2px solid var(--border-main)" }}>
                  {table.getVisibleLeafColumns().map((col, i) => {
                    const key = col.id;
                    const total = footerTotals[key];
                    const isNum = numericColKeys.has(key);
                    return (
                      <td
                        key={key || i}
                        className="px-3 py-2 font-bold text-[12px]"
                        style={{
                          color: total !== undefined ? "var(--text-heading)" : "var(--text-muted)",
                          textAlign: isNum ? "right" : "left",
                        }}
                      >
                        {i === 0 && total === undefined ? "Total" : total !== undefined ? total.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(total) ? 0 : 2, maximumFractionDigits: 2 }) : ""}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Schedule Modal (Mockup) */}
      {showSchedule && (
        <>
          <div className="fixed inset-0 z-50" style={{ background: "var(--overlay-bg)" }} onClick={() => setShowSchedule(false)} />
          <div
            className="fixed z-50 top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] rounded-2xl w-[480px] max-w-[92vw]"
            style={{ background: "var(--bg-modal)", border: "1px solid var(--border-main)", boxShadow: "var(--shadow-modal)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border-main)" }}>
              <div className="flex items-center gap-2">
                <CalendarClock size={18} style={{ color: "var(--nav-active-text)" }} />
                <div>
                  <h3 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>Schedule Export</h3>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{reportName} Report</p>
                </div>
              </div>
              <button onClick={() => setShowSchedule(false)} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none" style={{ background: "transparent", color: "var(--text-muted)" }}>
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-4">
              {/* Shared Drive Path */}
              <div>
                <label className="text-[12px] font-medium mb-1.5 block" style={{ color: "var(--text-primary)" }}>
                  <span className="flex items-center gap-1.5"><FolderOpen size={13} /> Shared Drive Path</span>
                </label>
                <input
                  type="text"
                  value={scheduleConfig.sharedDrivePath}
                  onChange={(e) => setScheduleConfig({ ...scheduleConfig, sharedDrivePath: e.target.value })}
                  placeholder="RPC_$Central Data/FastReports"
                  className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                  style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                />
                <p className="text-[10px] mt-1" style={{ color: "var(--text-faint)" }}>
                  File will be saved as: {reportName?.replace(/\s+/g, "_")}_YYYY-MM-DD.xlsx
                </p>
              </div>

              {/* Frequency */}
              <div>
                <label className="text-[12px] font-medium mb-1.5 block" style={{ color: "var(--text-primary)" }}>
                  <span className="flex items-center gap-1.5"><Clock size={13} /> Frequency</span>
                </label>
                <div className="flex gap-2">
                  {(["daily", "weekly", "monthly"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setScheduleConfig({ ...scheduleConfig, frequency: f })}
                      className="flex-1 text-[11px] font-medium py-2 rounded-lg cursor-pointer border-none transition-colors capitalize"
                      style={{
                        background: scheduleConfig.frequency === f ? "var(--nav-active-bg)" : "var(--bg-badge)",
                        color: scheduleConfig.frequency === f ? "var(--nav-active-text)" : "var(--text-muted)",
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time + Day config */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>Time</label>
                  <input
                    type="time"
                    value={scheduleConfig.time}
                    onChange={(e) => setScheduleConfig({ ...scheduleConfig, time: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                    style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                  />
                </div>
                {scheduleConfig.frequency === "weekly" && (
                  <div className="flex-1">
                    <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>Day of Week</label>
                    <select
                      value={scheduleConfig.dayOfWeek}
                      onChange={(e) => setScheduleConfig({ ...scheduleConfig, dayOfWeek: e.target.value })}
                      className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                      style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                    >
                      <option value="1">Monday</option>
                      <option value="2">Tuesday</option>
                      <option value="3">Wednesday</option>
                      <option value="4">Thursday</option>
                      <option value="5">Friday</option>
                      <option value="6">Saturday</option>
                      <option value="0">Sunday</option>
                    </select>
                  </div>
                )}
                {scheduleConfig.frequency === "monthly" && (
                  <div className="flex-1">
                    <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>Day of Month</label>
                    <select
                      value={scheduleConfig.dayOfMonth}
                      onChange={(e) => setScheduleConfig({ ...scheduleConfig, dayOfMonth: e.target.value })}
                      className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                      style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={String(d)}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Date Range for report */}
              <div>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--text-muted)" }}>Report Date Range</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: "yesterday", label: "Yesterday" },
                    { value: "thisWeek", label: "This Week" },
                    { value: "lastWeek", label: "Last Week" },
                    { value: "mtd", label: "Month to Date" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setScheduleConfig({ ...scheduleConfig, dateRange: opt.value })}
                      className="text-[11px] font-medium py-1.5 rounded-lg cursor-pointer border-none transition-colors"
                      style={{
                        background: scheduleConfig.dateRange === opt.value ? "var(--nav-active-bg)" : "var(--bg-badge)",
                        color: scheduleConfig.dateRange === opt.value ? "var(--nav-active-text)" : "var(--text-muted)",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Email notification toggle */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleConfig.emailNotify}
                  onChange={(e) => setScheduleConfig({ ...scheduleConfig, emailNotify: e.target.checked })}
                  className="rounded"
                />
                <span className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                  Email me when file is uploaded
                </span>
              </label>

              {/* Summary */}
              <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {scheduleConfig.frequency === "daily" && `Every day at ${scheduleConfig.time}`}
                  {scheduleConfig.frequency === "weekly" && `Every ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][Number(scheduleConfig.dayOfWeek)]} at ${scheduleConfig.time}`}
                  {scheduleConfig.frequency === "monthly" && `Every month on day ${scheduleConfig.dayOfMonth} at ${scheduleConfig.time}`}
                  {" — "}
                  {scheduleConfig.dateRange === "yesterday" ? "yesterday's data" : scheduleConfig.dateRange === "thisWeek" ? "this week (Mon–Sun)" : scheduleConfig.dateRange === "lastWeek" ? "last week (Mon–Sun)" : "month to date"}
                  {" → "}
                  <span style={{ color: "var(--text-primary)" }}>{scheduleConfig.sharedDrivePath}/{reportName?.replace(/\s+/g, "_")}_*.xlsx</span>
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: "1px solid var(--border-main)" }}>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded" style={{ background: "var(--color-warning-light)", color: "var(--text-inverse)" }}>
                COMING SOON
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSchedule(false)}
                  className="text-[12px] px-4 py-2 rounded-lg cursor-pointer border-none"
                  style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                >
                  Cancel
                </button>
                <button
                  disabled
                  className="text-[12px] font-medium px-4 py-2 rounded-lg cursor-not-allowed border-none opacity-50"
                  style={{ background: "var(--color-action)", color: "#fff" }}
                >
                  Save Schedule
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
