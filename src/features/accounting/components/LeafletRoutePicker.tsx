"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, RotateCcw, Building2 } from "lucide-react";
import { OFFICE_LOCATION, type LegValue } from "@/features/accounting/hooks/useTravelExpenseForm";
import { ROUTE_FIRST_DEST_LABEL, ROUTE_ORIGIN_LABEL } from "@/features/accounting/lib/route-waypoints";

interface Props {
  value: LegValue | null;
  onChange: (next: LegValue | null) => void;
  hqEnd?: "origin" | "destination";
}

interface Place {
  label: string;
  lat: number;
  lng: number;
}

const BKK: [number, number] = [13.7563, 100.5018];
const inputClass = "w-full rounded-lg px-3 py-2 text-[13px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

function pinIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}

/* ── Autocomplete search box (ORS geocoding via our proxy) ── */
function SearchBox({
  label, color, place, onPick, disabled,
}: {
  label: string;
  color: string;
  place: Place | null;
  onPick: (p: Place) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState(place?.label ?? "");
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQ(place?.label ?? "");
  }, [place?.label]);

  const handleChange = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (text.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await fetch(`/api/ors/geocode?q=${encodeURIComponent(text)}`);
        const json = await res.json();
        if (json.ok) {
          setSuggestions(json.data as Place[]);
          setOpen(true);
        }
      } catch {
        setSuggestions([]);
      }
    }, 350);
  };

  return (
    <div className="relative">
      <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
        <MapPin size={12} className="inline mr-1" style={{ color }} />
        {label}
      </label>
      <input
        className={inputClass}
        style={{ ...inputStyle, opacity: disabled ? 0.6 : 1 }}
        value={q}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (!disabled && suggestions.length > 0) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="ค้นหาสถานที่..."
        disabled={disabled}
        readOnly={disabled}
      />
      {open && suggestions.length > 0 && (
        <div
          className="absolute z-[1000] left-0 right-0 mt-1 rounded-lg py-1 shadow-lg max-h-48 overflow-auto"
          style={{ background: "var(--bg-dropdown)", border: "1px solid var(--border-main)" }}
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3 py-2 text-[12px] border-none cursor-pointer"
              style={{ background: "transparent", color: "var(--text-primary)" }}
              onMouseDown={() => { onPick(s); setQ(s.label); setOpen(false); }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Map + route picker ── */
export default function LeafletRoutePicker({ value, onChange, hqEnd }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const originMarker = useRef<L.Marker | null>(null);
  const destMarker = useRef<L.Marker | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);

  const [origin, setOrigin] = useState<Place | null>(
    value ? { label: value.origin, lat: value.originLat, lng: value.originLng } : null,
  );
  const [dest, setDest] = useState<Place | null>(
    value ? { label: value.destination, lat: value.destLat, lng: value.destLng } : null,
  );
  const [active, setActive] = useState<"origin" | "destination">("origin");
  const [error, setError] = useState<string | null>(null);
  const [hqLocked, setHqLocked] = useState(hqEnd === "origin");

  const activeRef = useRef(active);
  activeRef.current = active;
  const hqLockedRef = useRef(hqLocked);
  hqLockedRef.current = hqLocked;

  const emit = useCallback(
    (o: Place | null, d: Place | null, km: number) => {
      if (!o || !d) return;
      onChange({
        origin: o.label, originLat: o.lat, originLng: o.lng,
        destination: d.label, destLat: d.lat, destLng: d.lng,
        distanceKm: km,
      });
    },
    [onChange],
  );

  // Initialise the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current).setView(BKK, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (hqEnd === "origin" && hqLockedRef.current && activeRef.current === "origin") return;
      const p: Place = {
        label: `ปักหมุด (${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`,
        lat: e.latlng.lat, lng: e.latlng.lng,
      };
      if (activeRef.current === "origin") {
        setOrigin(p);
        setActive("destination");
      } else {
        setDest(p);
      }
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      originMarker.current = null;
      destMarker.current = null;
      routeLine.current = null;
    };
  }, []);

  // Sync markers when points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (origin) {
      if (!originMarker.current) originMarker.current = L.marker([origin.lat, origin.lng], { icon: pinIcon("#16a34a") }).addTo(map);
      else originMarker.current.setLatLng([origin.lat, origin.lng]);
    } else if (originMarker.current) {
      originMarker.current.remove();
      originMarker.current = null;
    }
  }, [origin]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (dest) {
      if (!destMarker.current) destMarker.current = L.marker([dest.lat, dest.lng], { icon: pinIcon("#dc2626") }).addTo(map);
      else destMarker.current.setLatLng([dest.lat, dest.lng]);
    } else if (destMarker.current) {
      destMarker.current.remove();
      destMarker.current = null;
    }
  }, [dest]);

  // Compute the route whenever both points are set.
  useEffect(() => {
    const map = mapRef.current;
    if (!origin || !dest) {
      if (routeLine.current && map) { routeLine.current.remove(); routeLine.current = null; }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ors/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: { lat: origin.lat, lng: origin.lng },
            destination: { lat: dest.lat, lng: dest.lng },
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error || "คำนวณเส้นทางไม่ได้ — ลองเลือกสถานที่ใหม่");
          return;
        }
        setError(null);
        const { distanceKm, polyline } = json.data as { distanceKm: number; polyline: [number, number][] };
        if (map) {
          if (routeLine.current) routeLine.current.remove();
          if (polyline.length > 0) {
            routeLine.current = L.polyline(polyline, { color: "#2563eb", weight: 4 }).addTo(map);
            map.fitBounds(routeLine.current.getBounds(), { padding: [30, 30] });
          }
        }
        emit(origin, dest, distanceKm);
      } catch {
        if (!cancelled) setError("คำนวณเส้นทางไม่ได้ — ลองเลือกสถานที่ใหม่");
      }
    })();
    return () => { cancelled = true; };
  }, [origin, dest, emit]);

  const handleReset = useCallback(() => {
    const hq: Place = {
      label: OFFICE_LOCATION.label,
      lat: OFFICE_LOCATION.lat,
      lng: OFFICE_LOCATION.lng,
    };
    const nextOrigin = hqEnd === "origin" ? hq : null;
    const nextDest = hqEnd === "destination" ? hq : null;
    const nextActive: "origin" | "destination" = hqEnd === "origin" ? "destination" : "origin";

    setOrigin(nextOrigin);
    setDest(nextDest);
    setActive(nextActive);
    setError(null);
    if (hqEnd === "origin") setHqLocked(true);
    if (routeLine.current) { routeLine.current.remove(); routeLine.current = null; }

    if (hqEnd === "origin") {
      onChange({
        origin: hq.label,
        originLat: hq.lat,
        originLng: hq.lng,
        destination: "",
        destLat: 0,
        destLng: 0,
        distanceKm: 0,
      });
    } else {
      onChange({
        origin: "",
        originLat: 0,
        originLng: 0,
        destination: hq.label,
        destLat: hq.lat,
        destLng: hq.lng,
        distanceKm: 0,
      });
    }

    const map = mapRef.current;
    if (map) map.setView([hq.lat, hq.lng], 14);
  }, [hqEnd, onChange]);

  const applyHqOrigin = useCallback(() => {
    const hq: Place = {
      label: OFFICE_LOCATION.label,
      lat: OFFICE_LOCATION.lat,
      lng: OFFICE_LOCATION.lng,
    };
    setOrigin(hq);
    setActive("destination");
    onChange({
      origin: hq.label,
      originLat: hq.lat,
      originLng: hq.lng,
      destination: dest?.label ?? "",
      destLat: dest?.lat ?? 0,
      destLng: dest?.lng ?? 0,
      distanceKm: value?.distanceKm ?? 0,
    });
    const map = mapRef.current;
    if (map) map.setView([hq.lat, hq.lng], 14);
  }, [dest, onChange, value?.distanceKm]);

  const toggleHqLocked = useCallback(() => {
    if (hqLocked) {
      setHqLocked(false);
      setActive("origin");
    } else {
      setHqLocked(true);
      applyHqOrigin();
    }
  }, [hqLocked, applyHqOrigin]);

  return (
    <div className="flex flex-col gap-3">
      {hqEnd === "origin" && (
        <button
          type="button"
          onClick={toggleHqLocked}
          aria-pressed={hqLocked}
          className="inline-flex items-center gap-1.5 self-start px-3.5 py-2 rounded-full text-[12px] font-bold cursor-pointer border-none transition-all"
          style={{
            background: hqLocked ? "var(--bg-info-yellow)" : "var(--bg-card-alt)",
            color: hqLocked ? "var(--text-info-yellow)" : "var(--text-muted)",
            boxShadow: hqLocked
              ? "0 1px 4px color-mix(in srgb, var(--color-warning-light) 22%, transparent), inset 0 0 0 1.5px var(--border-info-yellow)"
              : "inset 0 0 0 1px var(--border-light)",
          }}
        >
          <Building2 size={13} strokeWidth={2.25} />
          ในเวลาทำการ (HQ)
        </button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SearchBox
          label={ROUTE_ORIGIN_LABEL}
          color="var(--color-success)"
          place={origin}
          disabled={hqEnd === "origin" && hqLocked}
          onPick={(p) => { setOrigin(p); setActive("destination"); mapRef.current?.setView([p.lat, p.lng], 13); }}
        />
        <SearchBox
          label={ROUTE_FIRST_DEST_LABEL}
          color="var(--color-danger)"
          place={dest}
          onPick={(p) => { setDest(p); mapRef.current?.setView([p.lat, p.lng], 13); }}
        />
      </div>

      {/* Pin-mode hint */}
      <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <span>คลิกแผนที่เพื่อปัก:</span>
        <button
          type="button"
          className="px-2 py-0.5 rounded-full"
          style={{
            background: active === "origin" ? "var(--bg-info-green)" : "transparent",
            color: active === "origin" ? "var(--text-info-green)" : "var(--text-muted)",
            border: "1px solid var(--border-light)",
            opacity: hqEnd === "origin" && hqLocked ? 0.45 : 1,
          }}
          disabled={hqEnd === "origin" && hqLocked}
          onClick={() => setActive("origin")}
        >
          {ROUTE_ORIGIN_LABEL}
        </button>
        <button
          type="button"
          className="px-2 py-0.5 rounded-full"
          style={{
            background: active === "destination" ? "var(--bg-info-green)" : "transparent",
            color: active === "destination" ? "var(--text-info-green)" : "var(--text-muted)",
            border: "1px solid var(--border-light)",
          }}
          onClick={() => setActive("destination")}
        >
          {ROUTE_FIRST_DEST_LABEL}
        </button>
        {(origin || dest) && (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1"
            style={{ color: "var(--text-muted)" }}
            onClick={handleReset}
          >
            <RotateCcw size={11} /> ล้าง
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        style={{ width: "100%", height: "300px", borderRadius: "var(--radius-lg)", zIndex: 0 }}
      />

      {value && value.distanceKm > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-bold"
          style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}
        >
          ระยะทาง: {value.distanceKm} กม.
        </div>
      )}

      {error && (
        <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>{error}</p>
      )}
    </div>
  );
}
