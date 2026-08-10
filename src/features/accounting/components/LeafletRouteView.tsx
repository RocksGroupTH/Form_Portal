"use client";

import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Point {
  lat: number;
  lng: number;
}

interface Props {
  origin: Point;
  dest: Point;
  height?: number;
}

function isValid(lat: number, lng: number): boolean {
  if (lat === 0 && lng === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function pinIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}

/** Read-only Leaflet map: two pins + the driving route (falls back to a straight line). */
export default function LeafletRouteView({ origin, dest, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    if (!isValid(origin.lat, origin.lng) || !isValid(dest.lat, dest.lng)) return;

    const map = L.map(containerRef.current, {
      zoomAnimation: false,
      markerZoomAnimation: false,
      fadeAnimation: false,
      attributionControl: false,
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
    }).setView([origin.lat, origin.lng], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    L.marker([origin.lat, origin.lng], { icon: pinIcon("#16a34a") }).addTo(map);
    L.marker([dest.lat, dest.lng], { icon: pinIcon("#dc2626") }).addTo(map);
    mapRef.current = map;

    const bounds = L.latLngBounds([
      [origin.lat, origin.lng],
      [dest.lat, dest.lng],
    ]);
    map.fitBounds(bounds, { padding: [30, 30] });

    let cancelled = false;
    let line: L.Polyline | null = null;
    (async () => {
      try {
        const res = await fetch("/api/ors/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, destination: dest }),
        });
        const json = await res.json();
        const live = mapRef.current;
        if (cancelled || !live) return;
        const polyline = json?.ok ? (json.data.polyline as [number, number][]) : null;
        const pts: [number, number][] = polyline && polyline.length > 0
          ? polyline
          : [[origin.lat, origin.lng], [dest.lat, dest.lng]];
        line = L.polyline(pts, { color: "#2563eb", weight: 4 }).addTo(live);
        live.fitBounds(line.getBounds(), { padding: [30, 30] });
      } catch {
        /* keep the straight-line fallback / pins only */
      }
    })();

    return () => {
      cancelled = true;
      if (line) line.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.lat, origin.lng, dest.lat, dest.lng]);

  if (!isValid(origin.lat, origin.lng) || !isValid(dest.lat, dest.lng)) return null;

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, borderRadius: "var(--radius-lg)", zIndex: 0, overflow: "hidden" }}
    />
  );
}
