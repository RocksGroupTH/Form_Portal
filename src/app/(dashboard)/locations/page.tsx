"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { MapPin, LayoutGrid, ChevronDown, Search, X, Building2, Globe, Map as MapIcon } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { SidePanel } from "@/components/ui/SidePanel";
import { useIsMobile } from "@/lib/hooks/useIsMobile";
import type { StoreRow, Brand } from "@/features/locations/types";
import { getBrandColor, BRAND_COLOR_OVERRIDES, parseBrandColor } from "@/features/locations/constants";
import { StoreMap, StoreMapNoKey } from "@/features/locations/components/StoreMap";
import { StoreTable } from "@/features/locations/components/StoreTable";
import { StoreDetail } from "@/features/locations/components/StoreDetail";
import { useGoogleMapsApiKey } from "@/lib/hooks/useGoogleMapsApiKey";

type ViewMode = "map" | "table";

/* ── Stat Card ── */
function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl min-w-[140px]" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
      <div className="relative shrink-0">
        <svg width="36" height="44" viewBox="0 0 28 34" className="drop-shadow-sm">
          <path d="M14 0C6.3 0 0 6.3 0 14c0 8.4 14 20 14 20s14-11.6 14-20C28 6.3 21.7 0 14 0z" fill={color} opacity={0.15} />
          <path d="M14 0C6.3 0 0 6.3 0 14c0 8.4 14 20 14 20s14-11.6 14-20C28 6.3 21.7 0 14 0z" fill="none" stroke={color} strokeWidth="1.2" opacity={0.4} />
          <circle cx="14" cy="13" r="9" fill={`${color}20`} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center" style={{ color, paddingBottom: 8 }}>
          {icon}
        </div>
      </div>
      <div>
        <div className="text-[18px] font-black leading-tight" style={{ color: "var(--text-heading)" }}>{value}</div>
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</div>
      </div>
    </div>
  );
}

/* ── Filter Dropdown ── */
function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none text-[13px] font-semibold pl-3 pr-7 py-2 rounded-lg cursor-pointer outline-none"
        style={{ background: "var(--bg-input)", border: "1.5px solid var(--border-accent)", color: "var(--text-primary)" }}
      >
        <option value="all">{label}: All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
    </div>
  );
}

/* ── Loading ── */
function LocationsLoading() {
  return (
    <PageContainer maxWidth="2k" className="px-3 sm:px-4 md:px-0 py-6">
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: "var(--bg-selected)" }}>
            <MapPin size={28} style={{ color: "var(--text-muted)", animation: "pulse 1.5s ease-in-out infinite" }} />
          </div>
          <p className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>Loading locations...</p>
          <div className="mt-3 h-1 w-48 mx-auto rounded-full overflow-hidden" style={{ background: "var(--bg-selected)" }}>
            <div className="h-full rounded-full" style={{ background: "var(--accent)", width: "60%", animation: "pulse 1.5s ease-in-out infinite" }} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

/* ── Main Page ── */
export default function LocationsPage() {
  const isMobile = useIsMobile();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [selectedStore, setSelectedStore] = useState<StoreRow | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  /* Filters */
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  /* Fetch data */
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/locations");
        if (!res.ok) throw new Error("Failed to fetch locations");
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Failed");
        setBrands(json.data.brands);
        setStores(json.data.stores);
        if (json.data.lastSync) setLastSync(json.data.lastSync);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* Brand color map */
  const brandColorMap = useMemo(() => {
    const codes = Array.from(new Set(stores.map((s) => s.brandCode).filter((c): c is string => !!c))).sort();
    const map: Record<string, string> = {};
    let idx = 0;
    codes.forEach((code) => {
      if (BRAND_COLOR_OVERRIDES[code]) map[code] = BRAND_COLOR_OVERRIDES[code];
      else map[code] = getBrandColor(idx++);
    });
    brands.forEach((b) => {
      if (!map[b.code]) {
        if (BRAND_COLOR_OVERRIDES[b.code]) map[b.code] = BRAND_COLOR_OVERRIDES[b.code];
        else map[b.code] = getBrandColor(idx++);
      }
    });
    return map;
  }, [stores, brands]);

  /* Filter options */
  const filterOptions = useMemo(() => {
    const unique = (key: keyof StoreRow) => {
      const vals = stores.map((s) => s[key]).filter((v): v is string => !!v);
      return Array.from(new Set(vals)).sort().map((v) => ({ value: v, label: v }));
    };
    return { regions: unique("region"), statuses: unique("status") };
  }, [stores]);

  const activeFilterCount = [brandFilter, regionFilter, statusFilter].filter((f) => f !== "all").length;

  /* Filtered stores */
  const filtered = useMemo(() => {
    let list = stores;
    if (brandFilter !== "all") {
      const brandId = brands.find((b) => b.code === brandFilter)?.id;
      list = list.filter((s) => s.brandCode === brandFilter || s.locationBrandId === brandId);
    }
    if (regionFilter !== "all") list = list.filter((s) => s.region === regionFilter);
    if (statusFilter !== "all") list = list.filter((s) => s.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          (s.shopCode || "").toLowerCase().includes(q) ||
          (s.locationCode || "").toLowerCase().includes(q) ||
          (s.locationName || "").toLowerCase().includes(q) ||
          (s.storeName || "").toLowerCase().includes(q) ||
          (s.storeNameEn || "").toLowerCase().includes(q) ||
          (s.storeNameTh || "").toLowerCase().includes(q) ||
          (s.province || "").toLowerCase().includes(q) ||
          (s.district || "").toLowerCase().includes(q) ||
          (s.address || "").toLowerCase().includes(q) ||
          (s.region || "").toLowerCase().includes(q) ||
          (s.company || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [stores, brands, brandFilter, regionFilter, statusFilter, search]);

  /* Stats */
  const stats = useMemo(() => {
    const withCoords = filtered.filter((s) => s.lat != null && s.long != null).length;
    const uniqueRegions = new Set(filtered.map((s) => s.region).filter(Boolean)).size;
    const uniqueProvinces = new Set(filtered.map((s) => s.province).filter(Boolean)).size;
    const uniqueBrands = new Set(filtered.map((s) => s.locationBrandId).filter(Boolean)).size;
    return { total: filtered.length, withCoords, uniqueRegions, uniqueProvinces, uniqueBrands };
  }, [filtered]);

  const brandCounts = useMemo(() => {
    const map: Record<number, number> = {};
    for (const s of stores) {
      const bid = s.locationBrandId;
      if (bid) map[bid] = (map[bid] || 0) + 1;
    }
    return map;
  }, [stores]);

  const handleSelectStore = useCallback((store: StoreRow) => setSelectedStore(store), []);

  const clearAllFilters = () => {
    setSearch("");
    setBrandFilter("all");
    setRegionFilter("all");
    setStatusFilter("all");
  };

  const { apiKey, loading: mapsKeyLoading, configured: mapsConfigured } = useGoogleMapsApiKey();

  if (loading) return <LocationsLoading />;

  return (
    <PageContainer maxWidth="2k" className="px-3 sm:px-4 md:px-0 pb-24 md:pb-6" style={{ overflowX: "clip" as const }}>
      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg flex items-center justify-between" style={{ background: "#e74c3c10", border: "1px solid #e74c3c30", color: "var(--color-danger)" }}>
          <span className="text-[15px] font-semibold">{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer border-none bg-transparent text-xl" style={{ color: "var(--color-danger)" }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <PageHeaderBar
        icon={MapPin}
        title="Brand Locations"
        subtitle="Store master data across all brands (view-only from Codex)"
        right={
          lastSync ? (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold shrink-0" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
              <span style={{ color: "var(--text-muted)" }}>Location Sync:</span>
              <span style={{ color: "var(--text-heading)" }}>{lastSync}</span>
            </div>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="flex gap-3 mb-4 overflow-x-auto pb-1 -mx-3 px-3 md:mx-0 md:px-0">
        <StatCard icon={<Building2 size={18} />} label="Locations" value={stats.total} color="#2563eb" />
        <StatCard icon={<MapPin size={18} />} label="With GPS" value={stats.withCoords} color="#16a34a" />
        <StatCard icon={<Globe size={18} />} label="Brands" value={stats.uniqueBrands} color="#7c3aed" />
        <StatCard icon={<MapIcon size={18} />} label="Regions" value={stats.uniqueRegions} color="#d97706" />
      </div>

      {/* Toolbar */}
      <div className="mb-4 p-3 rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="flex flex-wrap gap-1.5 md:gap-2 items-center flex-1 min-w-0">
            {/* Search */}
            <div className="relative flex-1 min-w-[160px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search stores, codes, provinces..."
                className="w-full rounded-lg pl-9 pr-8 py-2 text-[13px] outline-none"
                style={{ background: "var(--bg-input)", border: "1.5px solid var(--border-accent)", color: "var(--text-primary)" }}
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer p-0" style={{ color: "var(--text-muted)" }}>
                  <X size={14} />
                </button>
              )}
            </div>

            {isMobile && <FilterSelect label="Region" value={regionFilter} options={filterOptions.regions} onChange={setRegionFilter} />}
            {isMobile && <FilterSelect label="Status" value={statusFilter} options={filterOptions.statuses} onChange={setStatusFilter} />}

            {activeFilterCount > 0 && (
              <button onClick={clearAllFilters} className="text-[12px] font-bold px-2.5 py-2 rounded-lg border-none cursor-pointer flex items-center gap-1" style={{ background: "var(--color-danger)", color: "#fff" }}>
                <X size={11} /> Clear {activeFilterCount}
              </button>
            )}
          </div>

          {/* View Toggle */}
          <div className="flex gap-0.5 p-0.5 rounded-lg shrink-0" style={{ background: "var(--bg-selected)" }}>
            {([
              { mode: "table" as const, icon: <LayoutGrid size={14} />, label: "Table" },
              { mode: "map" as const, icon: <MapPin size={14} />, label: "Map" },
            ]).map((v) => (
              <button
                key={v.mode}
                onClick={() => setViewMode(v.mode)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold cursor-pointer transition-all border-none"
                style={
                  viewMode === v.mode
                    ? v.mode === "map"
                      ? { background: "#16a34a14", color: "var(--color-success)", boxShadow: "0 1px 3px rgba(0,0,0,.1)", border: "1px solid #16a34a30" }
                      : { background: "var(--bg-card)", color: "var(--text-heading)", boxShadow: "0 1px 3px rgba(0,0,0,.1)" }
                    : { background: "transparent", color: "var(--text-muted)" }
                }
              >
                {v.icon} {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Brand pills + result count */}
        <div className="flex items-center justify-between mt-2.5 pt-2.5 gap-2" style={{ borderTop: "1px solid var(--border-card)" }}>
          <span className="text-[12px] font-semibold shrink-0 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            <svg width="8" height="11" viewBox="0 0 10 13" className="shrink-0">
              <path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8C10 2.24 7.76 0 5 0z" fill="var(--text-muted)" opacity={0.35} />
              <circle cx="5" cy="4.6" r="2" fill="var(--bg-card)" opacity={0.7} />
            </svg>
            Showing {filtered.length} of {stores.length} location{stores.length !== 1 ? "s" : ""}
          </span>
          <div className="flex gap-1 items-center overflow-x-auto no-scrollbar">
            {brands
              .filter((b) => b.isActive)
              .map((b) => {
                const isActive = brandFilter === b.code;
                const count = brandCounts[b.id] || 0;
                const [c1] = parseBrandColor(brandColorMap[b.code] || "#64748b");
                return (
                  <button
                    key={b.id}
                    onClick={() => setBrandFilter(isActive ? "all" : b.code)}
                    className="flex items-center gap-1.5 h-7 px-2.5 rounded-full cursor-pointer text-[12px] font-bold transition-all"
                    style={isActive ? { border: `1.5px solid ${c1}`, background: `${c1}14`, color: c1 } : { border: "1.5px solid var(--border-accent)", background: "transparent", color: "var(--text-muted)" }}
                  >
                    <svg width="10" height="13" viewBox="0 0 10 13" className="shrink-0">
                      <path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8C10 2.24 7.76 0 5 0z" fill={isActive ? c1 : "var(--text-muted)"} opacity={isActive ? 1 : 0.4} />
                      <circle cx="5" cy="4.6" r="2" fill={isActive ? "#fff" : "var(--bg-card)"} opacity={isActive ? 0.9 : 0.6} />
                    </svg>
                    {b.logo ? <img src={b.logo} alt={b.name} className="w-4 h-4 object-contain rounded" /> : null}
                    {b.code}
                    <span className="text-[11px] opacity-70">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      {stores.length === 0 && !loading ? (
        <div className="rounded-xl p-16 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <MapPin size={40} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
          <p className="text-[16px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>No Location Data</p>
          <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>Location data is managed in Codex. Please check that the database connection is working.</p>
        </div>
      ) : viewMode === "map" ? (
        <div style={{ height: isMobile ? "calc(100vh - 360px)" : "calc(100vh - 340px)", minHeight: 400 }}>
          {mapsKeyLoading ? (
            <div className="flex items-center justify-center h-full text-[13px]" style={{ color: "var(--text-muted)" }}>
              กำลังโหลดแผนที่...
            </div>
          ) : mapsConfigured && apiKey ? (
            <StoreMap stores={filtered} brands={brands} brandColorMap={brandColorMap} apiKey={apiKey} onSelectStore={handleSelectStore} />
          ) : (
            <StoreMapNoKey storeCount={filtered.filter((s) => s.lat && s.long).length} />
          )}
        </div>
      ) : (
        <StoreTable stores={filtered} brands={brands} brandColorMap={brandColorMap} onSelectStore={handleSelectStore} selectedId={selectedStore?.id} />
      )}

      {/* Store Detail SidePanel */}
      <SidePanel open={!!selectedStore} onClose={() => setSelectedStore(null)} width={isMobile ? "100%" : "55%"}>
        {selectedStore && (
          <StoreDetail
            store={selectedStore}
            brandColor={parseBrandColor(brandColorMap[selectedStore.brandCode || ""] || "#64748b")[0]}
            onClose={() => setSelectedStore(null)}
          />
        )}
      </SidePanel>
    </PageContainer>
  );
}
