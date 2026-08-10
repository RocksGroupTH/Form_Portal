"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ArrowUp, ArrowDown, ChevronDown, Filter, Check, Search, X } from "lucide-react";
import type { StoreRow, Brand } from "../types";
import { getStatusStyle, parseBrandColor } from "../constants";

type SortKey = "shopCode" | "storeName" | "brandCode" | "region" | "province" | "status" | "storeFormat" | "storeType" | "zone";

/* ── Column Filter Dropdown ── */
function ColumnFilterDropdown({
  header,
  allValues,
  filterValue,
  onFilterChange,
  sortDir,
  onSort,
  onClose,
  alignRight,
}: {
  header: string;
  allValues: string[];
  filterValue: string[] | undefined;
  onFilterChange: (values: string[] | undefined) => void;
  sortDir: false | "asc" | "desc";
  onSort: (desc: boolean) => void;
  onClose: () => void;
  alignRight?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const uniqueValues = useMemo(() => {
    const vals = Array.from(new Set(allValues.map((v) => v || "(Empty)"))).sort();
    if (!search) return vals;
    const q = search.normalize("NFC").toLowerCase();
    return vals.filter((v) => v.normalize("NFC").toLowerCase().includes(q));
  }, [allValues, search]);

  const allUniqueValues = useMemo(() => Array.from(new Set(allValues.map((v) => v || "(Empty)"))).sort(), [allValues]);
  const selected = useMemo(() => new Set(filterValue?.[0] === "__none__" ? [] : (filterValue ?? allUniqueValues)), [filterValue, allUniqueValues]);
  const allSelected = !filterValue;

  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    if (next.size === 0) {
      onFilterChange(["__none__"]);
      return;
    }
    if (next.size === allUniqueValues.length && allUniqueValues.every((v) => next.has(v))) {
      onFilterChange(undefined);
      return;
    }
    onFilterChange(Array.from(next));
  };

  return (
    <div
      ref={ref}
      className={`absolute top-full mt-1 z-50 rounded-lg overflow-hidden ${alignRight ? "right-0" : "left-0"}`}
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "0 8px 30px rgba(0,0,0,.2)", minWidth: 200, maxWidth: 280 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Sort */}
      <div className="px-1 pt-1" style={{ borderBottom: "1px solid var(--border-card)" }}>
        <button
          onClick={() => { onSort(false); onClose(); }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] font-semibold cursor-pointer border-none text-left"
          style={{ background: sortDir === "asc" ? "var(--accent)" + "14" : "transparent", color: sortDir === "asc" ? "var(--accent)" : "var(--text-secondary)" }}
        >
          <ArrowUp size={13} /> Sort A → Z
        </button>
        <button
          onClick={() => { onSort(true); onClose(); }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] font-semibold cursor-pointer border-none text-left mb-1"
          style={{ background: sortDir === "desc" ? "var(--accent)" + "14" : "transparent", color: sortDir === "desc" ? "var(--accent)" : "var(--text-secondary)" }}
        >
          <ArrowDown size={13} /> Sort Z → A
        </button>
      </div>
      {/* Search */}
      <div className="px-2 pt-2">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${header}...`}
            className="w-full text-[11px] pl-6 pr-2 py-1.5 rounded outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-accent)", color: "var(--text-primary)" }}
            autoFocus
          />
        </div>
      </div>
      {/* Select all / Clear */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => onFilterChange(undefined)}
          className="text-[10px] font-bold px-2 py-1 rounded cursor-pointer border-none"
          style={{ background: allSelected ? "var(--accent)" + "14" : "var(--bg-selected)", color: allSelected ? "var(--accent)" : "var(--text-muted)" }}
        >
          Select All
        </button>
        <button
          onClick={() => onFilterChange(["__none__"])}
          className="text-[10px] font-bold px-2 py-1 rounded cursor-pointer border-none"
          style={{ background: "var(--bg-selected)", color: "var(--text-muted)" }}
        >
          Clear
        </button>
      </div>
      {/* Values */}
      <div className="max-h-[220px] overflow-y-auto px-1 pb-1">
        {uniqueValues.map((val) => {
          const isSelected = allSelected || selected.has(val);
          return (
            <button
              key={val}
              onClick={() => toggle(val)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] cursor-pointer border-none text-left"
              style={{ background: isSelected ? "var(--accent)" + "08" : "transparent", color: "var(--text-secondary)" }}
            >
              <div
                className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                style={{ background: isSelected ? "var(--accent)" : "transparent", border: isSelected ? "none" : "1.5px solid var(--text-muted)" }}
              >
                {isSelected && <Check size={10} color="#fff" strokeWidth={3} />}
              </div>
              <span className="truncate" style={{ color: val === "(Empty)" ? "var(--text-muted)" : undefined, fontStyle: val === "(Empty)" ? "italic" : undefined }}>
                {val}
              </span>
            </button>
          );
        })}
        {uniqueValues.length === 0 && <div className="text-[11px] px-2.5 py-3 text-center" style={{ color: "var(--text-muted)" }}>No matches</div>}
      </div>
    </div>
  );
}

/* ── Store Table ── */
interface StoreTableProps {
  stores: StoreRow[];
  brands: Brand[];
  brandColorMap: Record<string, string>;
  onSelectStore: (store: StoreRow) => void;
  selectedId?: number | null;
}

const COLUMNS: { key: SortKey; label: string; width: string; hideOnMobile?: boolean }[] = [
  { key: "brandCode", label: "Brand", width: "70px" },
  { key: "shopCode", label: "Code", width: "110px" },
  { key: "storeName", label: "Store Name", width: "1.8fr" },
  { key: "storeType", label: "Type", width: "0.6fr", hideOnMobile: true },
  { key: "region", label: "Region", width: "0.8fr", hideOnMobile: true },
  { key: "province", label: "Province", width: "0.9fr", hideOnMobile: true },
  { key: "zone", label: "Zone", width: "0.5fr", hideOnMobile: true },
  { key: "storeFormat", label: "Format", width: "0.7fr", hideOnMobile: true },
  { key: "status", label: "Status", width: "90px" },
];

function getValue(store: StoreRow, key: SortKey): string {
  if (key === "storeName") return (store.locationName || "").toLowerCase();
  if (key === "shopCode") return (store.locationCode || store.shopCode || "").toLowerCase();
  const v = store[key as keyof StoreRow];
  return (v ?? "").toString().toLowerCase();
}

function getRawValue(store: StoreRow, key: SortKey): string {
  if (key === "storeName") return store.locationName || "";
  if (key === "shopCode") return store.locationCode || store.shopCode || "";
  const v = store[key as keyof StoreRow];
  return (v ?? "").toString();
}

export function StoreTable({ stores, brands, brandColorMap, onSelectStore, selectedId }: StoreTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("shopCode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string[] | undefined>>({});

  const handleSort = useCallback((key: SortKey, desc: boolean) => {
    setSortKey(key);
    setSortDir(desc ? "desc" : "asc");
  }, []);

  const handleFilterChange = useCallback((key: string, values: string[] | undefined) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (values === undefined) delete next[key];
      else next[key] = values;
      return next;
    });
  }, []);

  const activeFilterCount = Object.keys(columnFilters).length;

  const columnValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of COLUMNS) map[col.key] = stores.map((s) => getRawValue(s, col.key));
    return map;
  }, [stores]);

  const columnFiltered = useMemo(() => {
    const filterKeys = Object.keys(columnFilters);
    if (filterKeys.length === 0) return stores;
    return stores.filter((store) => {
      for (const key of filterKeys) {
        const allowed = columnFilters[key];
        if (!allowed) continue;
        if (allowed[0] === "__none__") return false;
        const val = getRawValue(store, key as SortKey) || "(Empty)";
        if (!allowed.includes(val)) return false;
      }
      return true;
    });
  }, [stores, columnFilters]);

  const sorted = useMemo(
    () =>
      [...columnFiltered].sort((a, b) => {
        const av = getValue(a, sortKey);
        const bv = getValue(b, sortKey);
        const dir = sortDir === "asc" ? 1 : -1;
        return av < bv ? -dir : av > bv ? dir : 0;
      }),
    [columnFiltered, sortKey, sortDir],
  );

  const brandByCode = useMemo(() => {
    const m = new Map<string, Brand>();
    brands.forEach((b) => m.set(b.code, b));
    return m;
  }, [brands]);

  const desktopGrid = COLUMNS.map((c) => c.width).join(" ");
  const mobileGrid = COLUMNS.filter((c) => !c.hideOnMobile).map((c) => c.width).join(" ");

  const toggleMobileSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div className="rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
      {/* Desktop Header */}
      <div
        className="hidden md:grid gap-3 px-4 py-2.5 items-center rounded-t-xl"
        style={{ gridTemplateColumns: desktopGrid, borderBottom: "1px solid var(--border-card)", background: "var(--bg-selected)" }}
      >
        {COLUMNS.map((col) => {
          const isOpen = openDropdown === col.key;
          const currentSort = sortKey === col.key ? sortDir : false;
          const hasFilter = !!columnFilters[col.key];
          return (
            <div
              key={col.key}
              className="text-[12px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer select-none relative"
              style={{ color: "var(--text-muted)" }}
              onClick={() => setOpenDropdown(isOpen ? null : col.key)}
            >
              {col.label}
              {currentSort === "asc" && <ArrowUp size={11} style={{ color: "var(--accent)" }} />}
              {currentSort === "desc" && <ArrowDown size={11} style={{ color: "var(--accent)" }} />}
              {!currentSort && <ChevronDown size={11} style={{ opacity: 0.3 }} />}
              {hasFilter && <Filter size={10} style={{ color: "var(--accent)" }} />}
              {isOpen && (
                <ColumnFilterDropdown
                  header={col.label}
                  allValues={columnValues[col.key] || []}
                  filterValue={columnFilters[col.key]}
                  onFilterChange={(vals) => handleFilterChange(col.key, vals)}
                  sortDir={currentSort}
                  onSort={(desc) => handleSort(col.key, desc)}
                  onClose={() => setOpenDropdown(null)}
                  alignRight={COLUMNS.indexOf(col) >= COLUMNS.length - 3}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile header */}
      <div
        className="md:hidden grid gap-3 px-3 py-2.5 items-center rounded-t-xl"
        style={{ gridTemplateColumns: mobileGrid, borderBottom: "1px solid var(--border-card)", background: "var(--bg-selected)" }}
      >
        {COLUMNS.filter((c) => !c.hideOnMobile).map((col) => (
          <div
            key={col.key}
            className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer select-none"
            style={{ color: sortKey === col.key ? "var(--text-heading)" : "var(--text-muted)" }}
            onClick={() => toggleMobileSort(col.key)}
          >
            {col.label}
            {sortKey === col.key && <span style={{ fontSize: 8 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
          </div>
        ))}
      </div>

      {/* Clear filters */}
      {activeFilterCount > 0 && (
        <div className="hidden md:flex items-center gap-2 px-4 py-1.5" style={{ background: "var(--bg-page)", borderBottom: "1px solid var(--border-card)" }}>
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
            {columnFiltered.length} of {stores.length} stores
          </span>
          <button
            onClick={() => setColumnFilters({})}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold cursor-pointer border-none"
            style={{ background: "var(--color-danger)", color: "#fff" }}
          >
            <X size={10} /> Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
          </button>
        </div>
      )}

      {/* Rows */}
      {sorted.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[15px] font-semibold" style={{ color: "var(--text-muted)" }}>No stores found</p>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Try adjusting your filters</p>
        </div>
      ) : (
        <div>
          {sorted.map((store, i) => {
            const brand = store.brandCode ? brandByCode.get(store.brandCode) : null;
            const [brandColor] = parseBrandColor(brandColorMap[brand?.code || ""] || "#64748b");
            const st = getStatusStyle(store.status);
            const isSelected = selectedId === store.id;

            return (
              <React.Fragment key={`${store.id}-${store.locationId}`}>
                {/* Desktop row */}
                <div
                  className="hidden md:grid gap-3 px-4 py-2.5 items-center cursor-pointer transition-colors"
                  style={{
                    gridTemplateColumns: desktopGrid,
                    borderBottom: i < sorted.length - 1 ? "1px solid var(--border-card)" : "none",
                    background: isSelected ? "var(--bg-selected)" : "transparent",
                  }}
                  onClick={() => onSelectStore(store)}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-selected)"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  <div>
                    {brand?.logo ? (
                      <img src={brand.logo} alt={brand.name} className="w-5 h-5 object-contain rounded" />
                    ) : (
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ color: brandColor, background: `${brandColor}14` }}>
                        {store.brandCode}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] font-semibold truncate" style={{ fontFamily: "monospace", color: "var(--text-primary)", letterSpacing: "0.3px" }}>
                    {store.locationCode || store.shopCode}
                  </div>
                  <div className="truncate">
                    <div className="text-[13px] font-bold truncate" style={{ color: "var(--text-heading)" }}>{store.locationName || "-"}</div>
                    {store.storeNameTh && <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{store.storeNameTh}</div>}
                  </div>
                  <div className="text-[12px] font-medium truncate" style={{ color: "var(--text-secondary)" }}>{store.storeType || "-"}</div>
                  <div className="text-[13px] truncate" style={{ color: "var(--text-secondary)" }}>{store.region || "-"}</div>
                  <div className="text-[13px] truncate" style={{ color: "var(--text-secondary)" }}>{store.province || "-"}</div>
                  <div className="text-[12px] font-medium truncate" style={{ color: "var(--text-secondary)" }}>{store.zone || "-"}</div>
                  <div className="text-[12px] font-medium truncate" style={{ color: "var(--text-secondary)" }}>{store.storeFormat || "-"}</div>
                  <div>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ color: st.color, background: st.bg }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />
                      {store.status || "-"}
                    </span>
                  </div>
                </div>

                {/* Mobile row */}
                <div
                  className="md:hidden grid gap-3 px-3 py-2.5 items-center cursor-pointer touch-manipulation active:scale-[0.99]"
                  style={{
                    gridTemplateColumns: mobileGrid,
                    borderBottom: i < sorted.length - 1 ? "1px solid var(--border-card)" : "none",
                    background: isSelected ? "var(--bg-selected)" : "transparent",
                  }}
                  onClick={() => onSelectStore(store)}
                >
                  <div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: brandColor, background: `${brandColor}14` }}>
                      {store.brandCode}
                    </span>
                  </div>
                  <div className="text-[12px] font-semibold truncate" style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>
                    {store.locationCode || store.shopCode}
                  </div>
                  <div className="truncate">
                    <div className="text-[12px] font-bold truncate" style={{ color: "var(--text-heading)" }}>{store.locationName || "-"}</div>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: st.color, background: st.bg }}>
                      {store.status || "-"}
                    </span>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 flex items-center justify-between rounded-b-xl" style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-selected)" }}>
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>
          {sorted.length} store{sorted.length !== 1 ? "s" : ""}
        </span>
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Click a row to view details</span>
      </div>
    </div>
  );
}
