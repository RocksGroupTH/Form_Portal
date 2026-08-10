"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { GoogleMap, useJsApiLoader, InfoWindowF } from "@react-google-maps/api";
import type { StoreRow, Brand } from "../types";
import { createPinSvg, getStatusStyle, parseBrandColor } from "../constants";
import { GOOGLE_MAPS_LOADER_ID, GOOGLE_MAPS_LIBRARIES } from "@/lib/google-maps-constants";

const MAP_CENTER = { lat: 13.7563, lng: 100.5018 };
const MAP_ZOOM = 6;

const containerStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  borderRadius: "var(--radius-lg)",
};

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: true,
  mapId: "DEMO_MAP_ID",
};

/* ── AdvancedMarker wrapper ── */
function AdvancedMapMarker({
  map,
  position,
  title,
  color,
  onClick,
}: {
  map: google.maps.Map | null;
  position: google.maps.LatLngLiteral;
  title?: string;
  color: string;
  onClick?: () => void;
}) {
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (!map) return;

    const el = document.createElement("div");
    el.innerHTML = createPinSvg(color);
    el.style.cursor = "pointer";
    el.style.width = "28px";
    el.style.height = "40px";

    const marker = new google.maps.marker.AdvancedMarkerElement({
      map,
      position,
      title,
      content: el,
    });

    const listener = marker.addListener("click", () => {
      onClickRef.current?.();
    });

    markerRef.current = marker;

    return () => {
      listener.remove();
      marker.map = null;
      markerRef.current = null;
    };
  }, [map, position.lat, position.lng, title, color]);

  return null;
}

/* ── Main Map ── */
interface StoreMapProps {
  stores: StoreRow[];
  brands: Brand[];
  brandColorMap: Record<string, string>;
  apiKey: string;
  onSelectStore: (store: StoreRow) => void;
}

export function StoreMap({ stores, brands, brandColorMap, apiKey, onSelectStore }: StoreMapProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [infoStore, setInfoStore] = useState<StoreRow | null>(null);
  const [hiddenBrands, setHiddenBrands] = useState<Set<string>>(new Set());

  const prevStoresRef = useRef(stores);
  useEffect(() => {
    if (prevStoresRef.current !== stores) {
      setHiddenBrands(new Set());
      setInfoStore(null);
      prevStoresRef.current = stores;
    }
  }, [stores]);

  const storesWithCoords = useMemo(
    () => stores.filter((s) => s.lat != null && s.long != null),
    [stores],
  );

  const visibleStores = useMemo(
    () =>
      hiddenBrands.size === 0
        ? storesWithCoords
        : storesWithCoords.filter((s) => !hiddenBrands.has(s.brandCode || "")),
    [storesWithCoords, hiddenBrands],
  );

  const toggleBrand = useCallback((code: string) => {
    setHiddenBrands((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setInfoStore(null);
  }, []);

  const center = useMemo(() => {
    if (storesWithCoords.length === 0) return MAP_CENTER;
    const lats = storesWithCoords.map((s) => s.lat!);
    const lngs = storesWithCoords.map((s) => s.long!);
    return {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
    };
  }, [storesWithCoords]);

  const handleMarkerClick = useCallback((store: StoreRow) => setInfoStore(store), []);
  const handleInfoClose = useCallback(() => setInfoStore(null), []);
  const handleMapLoad = useCallback((map: google.maps.Map) => setMapInstance(map), []);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: "var(--bg-selected)", borderRadius: "var(--radius-lg)" }}>
        <div className="text-center p-8">
          <p className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>Failed to load Google Maps</p>
          <p className="text-[13px] mt-1" style={{ color: "var(--text-muted)" }}>Check your API key configuration</p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: "var(--bg-selected)", borderRadius: "var(--radius-lg)" }}>
        <p className="text-[14px] font-semibold" style={{ color: "var(--text-muted)" }}>Loading map...</p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <GoogleMap mapContainerStyle={containerStyle} center={center} zoom={MAP_ZOOM} options={MAP_OPTIONS} onLoad={handleMapLoad}>
        {mapInstance &&
          visibleStores.map((store) => {
            const color = brandColorMap[store.brandCode || ""] || "#64748b";
            return (
              <AdvancedMapMarker
                key={`${store.id}-${store.locationId}`}
                map={mapInstance}
                position={{ lat: store.lat!, lng: store.long! }}
                title={store.storeNameEn || store.storeName || store.shopCode}
                color={color}
                onClick={() => handleMarkerClick(store)}
              />
            );
          })}

        {infoStore && infoStore.lat != null && infoStore.long != null && (
          <InfoWindowF position={{ lat: infoStore.lat, lng: infoStore.long }} onCloseClick={handleInfoClose}>
            <div style={{ maxWidth: 260, fontFamily: "inherit" }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4, color: "#1a1a1a" }}>
                {infoStore.storeNameEn || infoStore.locationName || infoStore.shopCode}
              </div>
              {infoStore.storeNameTh && <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{infoStore.storeNameTh}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                {(() => {
                  const raw = brandColorMap[infoStore.brandCode || ""] || "#64748b";
                  const [c1] = parseBrandColor(raw);
                  return (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9999, color: c1, background: `${c1}18` }}>
                      {infoStore.brandCode}
                    </span>
                  );
                })()}
                {infoStore.status &&
                  (() => {
                    const st = getStatusStyle(infoStore.status);
                    return (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9999, color: st.color, background: st.bg }}>
                        {infoStore.status}
                      </span>
                    );
                  })()}
              </div>
              {infoStore.province && (
                <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
                  {infoStore.province}
                  {infoStore.district ? `, ${infoStore.district}` : ""}
                </div>
              )}
              <button
                onClick={() => {
                  onSelectStore(infoStore);
                  handleInfoClose();
                }}
                style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                View Details
              </button>
            </div>
          </InfoWindowF>
        )}
      </GoogleMap>

      {/* Brand legend */}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          left: 12,
          zIndex: 1,
          background: "white",
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          fontSize: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 14px",
          maxWidth: 320,
        }}
      >
        {brands
          .filter((b) => b.isActive)
          .map((b) => {
            const raw = brandColorMap[b.code] || "#64748b";
            const [c1, c2] = parseBrandColor(raw);
            const isHidden = hiddenBrands.has(b.code);
            return (
              <div
                key={b.id}
                onClick={() => toggleBrand(b.code)}
                style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", opacity: isHidden ? 0.35 : 1, transition: "opacity 0.15s" }}
                title={isHidden ? `Show ${b.code}` : `Hide ${b.code}`}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: c2 ? `linear-gradient(90deg, ${c1} 50%, ${c2} 50%)` : c1,
                    display: "inline-block",
                    border: c2 === "#ffffff" ? "1px solid #ccc" : undefined,
                  }}
                />
                <span style={{ fontWeight: 600, color: "#333", textDecoration: isHidden ? "line-through" : undefined }}>{b.code}</span>
              </div>
            );
          })}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontWeight: 600, color: "#999" }}>{visibleStores.length} pins</span>
        </div>
      </div>
    </div>
  );
}

/** Fallback when no API key is configured */
export function StoreMapNoKey({ storeCount }: { storeCount: number }) {
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ background: "var(--bg-selected)", borderRadius: "var(--radius-lg)", border: "2px dashed var(--border-accent)" }}
    >
      <div className="text-center p-8 max-w-md">
        <p className="text-[16px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>Google Maps Not Configured</p>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          ตั้งค่า Google Maps API Key ที่ Settings → Google Maps (หรือ{" "}
          <code className="px-1.5 py-0.5 rounded text-[12px]" style={{ background: "var(--bg-input)", border: "1px solid var(--border-accent)" }}>
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          </code>{" "}
          ใน .env) เพื่อแสดง {storeCount} สาขาบนแผนที่
        </p>
      </div>
    </div>
  );
}
