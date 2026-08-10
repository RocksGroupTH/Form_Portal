"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { X, ArrowUp, MapPin, Wrench, Zap, ChevronDown, ChevronRight } from "lucide-react";
import type { StoreRow } from "../types";
import { getStatusStyle, getStoreTypeColor } from "../constants";

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "-";
  }
}

function isValidCoord(lat: number | null | undefined, long: number | null | undefined): boolean {
  if (lat == null || long == null) return false;
  return Number.isFinite(lat) && Number.isFinite(long) && lat >= -90 && lat <= 90 && long >= -180 && long <= 180 && !(lat === 0 && long === 0);
}

function getMapPreviewUrl(shopCode: string | undefined, lat: number | null | undefined, long: number | null | undefined): string | null {
  if (!shopCode || !isValidCoord(lat, long)) return null;
  return `/api/map-preview?shopCode=${encodeURIComponent(shopCode)}&lat=${lat}&long=${long}`;
}

/* ── Collapsible Section ── */
function Section({
  icon, title, children, defaultOpen = true, badge, accentColor,
}: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
  defaultOpen?: boolean; badge?: React.ReactNode; accentColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const accent = accentColor || "var(--accent)";
  return (
    <div className="mb-3 rounded-lg overflow-hidden" style={{ border: `1px solid ${open ? "var(--border-card)" : "var(--border-accent)"}`, background: "var(--bg-card)" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 py-3 px-3.5 cursor-pointer transition-colors"
        style={{
          background: open ? "var(--bg-selected)" : "transparent",
          borderLeft: `3px solid ${open ? accent : "var(--border-accent)"}`,
          borderTop: "none", borderRight: "none",
          borderBottom: open ? "1px solid var(--border-card)" : "none",
          color: open ? "var(--text-heading)" : "var(--text-secondary)",
        }}
      >
        <span className="shrink-0" style={{ color: open ? accent : "var(--text-muted)" }}>{icon}</span>
        <span className="text-[13px] font-bold uppercase tracking-wider flex-1 text-left">{title}</span>
        {badge}
        {open ? <ChevronDown size={14} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />}
      </button>
      {open && <div className="px-4 pt-2.5 pb-2">{children}</div>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between items-start py-1.5 gap-3" style={{ borderBottom: "1px solid var(--border-card)" }}>
      <span className="text-[13px] font-medium shrink-0" style={{ color: "var(--text-muted)", minWidth: 100 }}>{label}</span>
      <span className="text-[14px] font-semibold text-right" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="text-[12px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--accent)" + "18", color: "var(--accent)" }}>
      {count}
    </span>
  );
}

/* ── Main ── */
interface StoreDetailProps {
  store: StoreRow;
  brandColor: string;
  onClose: () => void;
}

export function StoreDetail({ store, brandColor, onClose }: StoreDetailProps) {
  const st = getStatusStyle(store.status);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const displayName = store.locationName || "";
  const displayCode = store.locationCode || store.shopCode || "";

  const mapSrc = getMapPreviewUrl(store.shopCode || store.locationCode, store.lat, store.long);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  useEffect(() => { setMapLoaded(false); setMapError(false); }, [store.shopCode, store.lat, store.long]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setShowScrollTop(e.currentTarget.scrollTop > 200);
  };

  const dp = store.deliveryPlatforms || [];
  const eq = store.equipment || [];
  const pm = store.paymentMethods || [];
  const pr = store.products || [];
  const activePm = pm.filter((p) => p.isActive).length;
  const availPr = pr.filter((p) => p.isAvailable).length;

  const eqByCategory = useMemo(() => {
    const map: Record<string, typeof eq> = {};
    for (const e of eq) {
      if (!map[e.category]) map[e.category] = [];
      map[e.category].push(e);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [eq]);

  const hasFacilities = store.powerSpec || store.waterSupply || store.wasteWater || store.exhaustCFM || store.gasSystem || store.hood || store.internetProvider || store.meNote;
  const hasMenu = store.menuType || store.drinkMenu || store.priceList || pr.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header with brand accent */}
      <div className="shrink-0" style={{ borderBottom: "1px solid var(--border-card)" }}>
        <div style={{ height: 3, background: brandColor }} />
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {store.storeType && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ color: "#fff", background: getStoreTypeColor(store.storeType) }}>
                  {store.storeType}
                </span>
              )}
              <h2 className="text-[20px] font-black m-0 leading-tight" style={{ color: "var(--text-heading)" }}>
                {displayName}
              </h2>
              <span className="text-[12px] font-mono font-semibold px-1.5 py-0.5 rounded" style={{ color: "var(--text-secondary)", background: "var(--bg-selected)", letterSpacing: "0.5px" }}>
                {displayCode}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ color: brandColor, background: `${brandColor}18` }}>
                {store.brandCode}
              </span>
              {store.status && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ color: st.color, background: st.bg }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />
                  {store.status}
                </span>
              )}
              {store.shopClass && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: "var(--bg-selected)", color: "var(--text-muted)" }}>
                  {store.shopClass}
                </span>
              )}
              {store.storeNameTh && (
                <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>{store.storeNameTh}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            style={{ background: "var(--bg-selected)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 pb-5">
        {/* Map preview — cached static image */}
        {isValidCoord(store.lat, store.long) && (
          <a
            href={`https://www.google.com/maps?q=${store.lat},${store.long}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block mb-3 mt-3 rounded-lg overflow-hidden relative"
            style={{ border: "1px solid var(--border-card)", height: 140 }}
          >
            {mapSrc && !mapError ? (
              <img
                src={mapSrc}
                alt="Store location"
                className="w-full h-full object-cover"
                onLoad={() => setMapLoaded(true)}
                onError={() => setMapError(true)}
              />
            ) : null}
            <div
              className={`${mapLoaded && !mapError ? "hidden" : ""} absolute inset-0 flex items-center justify-center gap-2`}
              style={{ background: "var(--bg-selected)" }}
            >
              <MapPin size={16} style={{ color: "var(--accent)" }} />
              <span className="text-[13px] font-semibold" style={{ color: "var(--accent)" }}>
                {mapSrc && !mapError ? "Loading map..." : `${store.lat!.toFixed(4)}, ${store.long!.toFixed(4)} — Open in Google Maps`}
              </span>
            </div>
          </a>
        )}

        {/* Summary card */}
        <div className="mb-4 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)" }}>
          {/* Store info grid + address */}
          <div className="p-3.5" style={{ borderBottom: "1px solid var(--border-card)" }}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5">
              {[
                { label: "Company", value: store.company },
                { label: "Region", value: store.region },
                { label: "Province", value: store.province },
                { label: "District", value: store.district },
                { label: "Format", value: store.storeFormat },
                { label: "Type (BD)", value: store.storeType },
                { label: "Type (MKT)", value: store.storeTypeMKT },
                { label: "Shop Class", value: store.shopClass },
                { label: "Store Size", value: store.storeSize != null ? `${store.storeSize.toLocaleString()} sqm` : null },
                { label: "Stock Size", value: store.stockSize != null ? `${store.stockSize.toLocaleString()} sqm` : null },
                { label: "Seats", value: store.seatCount != null ? String(store.seatCount) : null },
                { label: "Zone", value: store.zone },
                { label: "Floor", value: store.floor },
                { label: "Room", value: store.roomNo },
                { label: "Opening Date", value: formatDate(store.openingDate) },
                { label: "Year", value: store.year ? String(store.year) : null },
                { label: "Lat", value: store.lat != null ? store.lat.toFixed(6) : null },
                { label: "Long", value: store.long != null ? store.long.toFixed(6) : null },
              ].map((f) => (
                <div key={f.label}>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{f.label}</div>
                  <div className="text-[14px] font-semibold truncate" style={{ color: f.value ? "var(--text-primary)" : "var(--text-muted)" }}>{f.value || "-"}</div>
                </div>
              ))}
              {/* Address — full width */}
              <div className="col-span-2 md:col-span-4 flex items-start gap-3 pt-1">
                <span className="text-[10px] font-bold uppercase tracking-wider shrink-0 pt-0.5" style={{ color: "var(--text-muted)" }}>Address</span>
                <span className="text-[13px] leading-relaxed flex-1" style={{ color: store.address ? "var(--text-secondary)" : "var(--text-muted)" }}>{store.address || "-"}</span>
              </div>
            </div>
          </div>

          {/* 3-col: Tax & Registration | Hours | Contacts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0" style={{ borderBottom: "1px solid var(--border-card)" }}>
            {/* Tax */}
            <div className="p-3.5" style={{ borderRight: "1px solid var(--border-card)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Tax & Registration</div>
              {[
                { label: "Cashier S/N", value: store.cashierSerialNo },
                { label: "Cash RD No.", value: store.cashRDNo },
                { label: "Revenue Branch", value: store.revenueDeptBranchCode },
                { label: "VAT Register", value: store.vatRegister },
              ].map((f) => (
                <div key={f.label} className="flex justify-between py-0.5">
                  <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{f.label}</span>
                  <span className="text-[12px] font-mono font-semibold" style={{ color: f.value ? "var(--text-primary)" : "var(--text-muted)" }}>{f.value || "-"}</span>
                </div>
              ))}
            </div>
            {/* Hours */}
            <div className="p-3.5" style={{ borderRight: "1px solid var(--border-card)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Operating Hours</div>
              {[
                { label: "Weekday", value: (store.openTimeWeekday || store.closeTimeWeekday) ? `${store.openTimeWeekday || "-"} – ${store.closeTimeWeekday || "-"}` : null },
                { label: "Weekend", value: (store.openTimeWeekend || store.closeTimeWeekend) ? `${store.openTimeWeekend || "-"} – ${store.closeTimeWeekend || "-"}` : null },
                { label: "Delivery", value: (store.openTimeDelivery || store.closeTimeDelivery) ? `${store.openTimeDelivery || "-"} – ${store.closeTimeDelivery || "-"}` : null },
              ].map((f) => (
                <div key={f.label} className="flex justify-between py-0.5">
                  <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{f.label}</span>
                  <span className="text-[13px] font-mono font-semibold" style={{ color: f.value ? "var(--text-primary)" : "var(--text-muted)" }}>{f.value || "-"}</span>
                </div>
              ))}
            </div>
            {/* Contacts */}
            <div className="p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Contacts</div>
              {[
                { label: "Store Phone", value: store.phone },
                { label: "Area Manager", value: store.areaManagerName },
                { label: "AM Phone", value: store.areaManagerPhone },
                { label: "Team Leader", value: store.teamLeaderName },
                { label: "TL Phone", value: store.teamLeaderPhone },
              ].map((f) => (
                <div key={f.label} className="flex justify-between py-0.5">
                  <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{f.label}</span>
                  <span className="text-[13px] font-semibold truncate ml-2" style={{ color: f.value ? "var(--text-primary)" : "var(--text-muted)" }}>{f.value || "-"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Delivery + Payment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0" style={{ borderBottom: hasMenu ? "1px solid var(--border-card)" : "none" }}>
            {dp.length > 0 && (
              <div className="p-3.5" style={{ borderRight: "1px solid var(--border-card)" }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Delivery Platforms</div>
                {dp.map((d) => (
                  <div key={d.platformName} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.isActive ? "var(--color-success)" : "var(--border-accent)" }} />
                      <span className="text-[13px] font-semibold" style={{ color: d.isActive ? "var(--text-primary)" : "var(--text-muted)" }}>{d.platformName}</span>
                    </div>
                    {d.merchantId && (
                      <span className="text-[11px] font-mono" style={{ color: "var(--text-secondary)" }}>{d.merchantId}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {pm.length > 0 && (
              <div className="p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                  Payment Methods ({activePm}/{pm.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pm.map((p) => (
                    <span
                      key={p.methodName}
                      className="text-[11px] font-bold px-2 py-1 rounded"
                      style={p.isActive ? {
                        background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
                      } : {
                        background: "transparent", color: "var(--text-muted)", border: "1px dashed var(--border-accent)", textDecoration: "line-through",
                      }}
                    >
                      {p.methodName.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")}
                    </span>
                  ))}
                </div>
                {hasMenu && (
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-card)" }}>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {[
                        { label: "Menu Type", value: store.menuType },
                        { label: "Drink Menu", value: store.drinkMenu },
                        { label: "Price List", value: store.priceList },
                      ].filter((f) => f.value).map((f) => (
                        <div key={f.label} className="flex justify-between py-0.5">
                          <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{f.label}</span>
                          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{f.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Products — full width */}
          {pr.length > 0 && (
            <div className="p-3.5" style={{ borderTop: "1px solid var(--border-card)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                Products ({availPr}/{pr.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pr.map((p) => (
                  <span
                    key={p.productName}
                    className="text-[11px] font-bold px-2 py-1 rounded"
                    style={p.isAvailable ? {
                      background: "color-mix(in srgb, var(--color-warning) 12%, transparent)", color: "var(--color-warning)", border: "1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)",
                    } : {
                      background: "transparent", color: "var(--text-muted)", border: "1px dashed var(--border-accent)", textDecoration: "line-through",
                    }}
                  >
                    {p.productName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Collapsible sections: Equipment + Facilities */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0">
          <div>
            {eq.length > 0 && (
              <Section icon={<Wrench size={15} />} title="Equipment" defaultOpen={false} badge={<CountBadge count={eq.length} />} accentColor="#7c3aed">
                <div className="grid grid-cols-2 gap-2">
                  {eqByCategory.map(([category, items]) => (
                    <div key={category} className="p-2.5 rounded-lg" style={{ background: "var(--bg-selected)", border: "1px solid var(--border-card)" }}>
                      <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between" style={{ color: "var(--text-muted)" }}>
                        <span>{category}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--accent)" + "14", color: "var(--accent)" }}>{items.length}</span>
                      </div>
                      {items.map((e) => (
                        <div key={`${e.category}-${e.itemName}`} className="flex justify-between items-center py-1">
                          <span className="text-[12px] font-medium truncate mr-2" style={{ color: "var(--text-primary)" }}>{e.itemName}</span>
                          <span className="text-[12px] font-bold font-mono shrink-0" style={{ color: "var(--accent)" }}>x{e.quantity}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
          <div>
            {hasFacilities && (
              <Section icon={<Zap size={15} />} title="Facilities / M&E" defaultOpen={false} accentColor="#0891b2">
                <Field label="Internet" value={store.internetProvider} />
                <Field label="Power Spec" value={store.powerSpec} />
                <Field label="Water Supply" value={store.waterSupply} />
                <Field label="Waste Water" value={store.wasteWater} />
                <Field label="Exhaust (CFM)" value={store.exhaustCFM} />
                <Field label="Gas System" value={store.gasSystem} />
                <Field label="Hood" value={store.hood} />
                {store.meNote && (
                  <div className="mt-2 p-3 rounded-lg text-[13px] leading-relaxed" style={{ background: "var(--bg-selected)", color: "var(--text-secondary)", border: "1px solid var(--border-card)" }}>
                    {store.meNote}
                  </div>
                )}
              </Section>
            )}
          </div>
        </div>
      </div>

      {/* Scroll to top FAB */}
      {showScrollTop && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="absolute bottom-5 right-5 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer border-none shadow-lg transition-opacity z-10"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          <ArrowUp size={18} />
        </button>
      )}
    </div>
  );
}
