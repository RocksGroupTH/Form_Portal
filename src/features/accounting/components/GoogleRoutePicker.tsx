"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, DirectionsRenderer, Marker } from "@react-google-maps/api";
import { MapPin, RotateCcw, Crosshair, Loader2, Plus, X, Building2 } from "lucide-react";
import { OFFICE_LOCATION, type LegValue } from "@/features/accounting/hooks/useTravelExpenseForm";
import { extraDestinationLabel, ROUTE_FIRST_DEST_LABEL, ROUTE_ORIGIN_LABEL, buildRouteStopChain } from "@/features/accounting/lib/route-waypoints";
import { GoogleMapsJsLoader } from "@/components/maps/GoogleMapsJsLoader";
import {
  BANGKOK_CENTER,
  GOOGLE_MAP_CONTAINER,
  GOOGLE_MAP_OPTIONS,
} from "@/lib/google-maps-constants";
import { MAPS_UNAVAILABLE_USER_MESSAGE } from "@/features/accounting/constants";

interface Props {
  value: LegValue | null;
  onChange: (next: LegValue | null) => void;
  hqEnd?: "origin" | "destination";
  allowWaypoints?: boolean;
}

interface Place {
  label: string;
  lat: number;
  lng: number;
}

/** Which stop receives the next map click / search pick. */
type ActiveStop = "origin" | "destination" | number;

const inputClass = "w-full rounded-lg px-3 py-2 text-[13px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-input)",
};

function isValidCoord(lat: number, lng: number): boolean {
  if (lat === 0 && lng === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function placeFromValue(
  label: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Place | null {
  if (!label?.trim() || lat == null || lng == null) return null;
  if (!isValidCoord(lat, lng)) return null;
  return { label: label.trim(), lat, lng };
}

function usePlaceAutocomplete(isLoaded: boolean) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (input: string) => {
    if (!isLoaded || input.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      }
      const response = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: sessionTokenRef.current,
        locationBias: { lat: BANGKOK_CENTER.lat, lng: BANGKOK_CENTER.lng, radius: 200000 },
      });
      setSuggestions(response.suggestions || []);
      setShowDropdown(true);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [isLoaded]);

  const handleInputChange = useCallback((text: string) => {
    setQuery(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => search(text), 300);
  }, [search]);

  const resetToken = useCallback(() => {
    sessionTokenRef.current = null;
  }, []);

  return { query, setQuery, suggestions, showDropdown, setShowDropdown, handleInputChange, resetToken, loading };
}

function PlaceSearchBox({
  label,
  color,
  ac,
  isLoaded,
  onSelect,
  onActivate,
  disabled,
  onRemove,
}: {
  label: string;
  color: string;
  ac: ReturnType<typeof usePlaceAutocomplete>;
  isLoaded: boolean;
  onSelect: (s: google.maps.places.AutocompleteSuggestion) => void;
  onActivate?: () => void;
  disabled?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="block text-[12px] font-medium cursor-pointer m-0" style={{ color: "var(--text-secondary)" }}>
          <MapPin size={12} className="inline mr-1" style={{ color }} />
          {label}
        </label>
        {onRemove && (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border-none cursor-pointer"
            style={{ color: "var(--color-danger)", background: "transparent" }}
            onClick={onRemove}
          >
            <X size={11} /> ลบ
          </button>
        )}
      </div>
      <div className="relative">
        <input
          className={inputClass}
          style={{ ...inputStyle, paddingRight: ac.loading ? 34 : undefined, opacity: disabled ? 0.6 : 1 }}
          value={ac.query}
          onChange={(e) => ac.handleInputChange(e.target.value)}
          onFocus={() => {
            if (disabled) return;
            onActivate?.();
            if (ac.suggestions.length > 0) ac.setShowDropdown(true);
          }}
          onClick={() => { if (!disabled) onActivate?.(); }}
          onBlur={() => setTimeout(() => ac.setShowDropdown(false), 200)}
          placeholder="ค้นหาสถานที่..."
          disabled={!isLoaded || disabled}
          readOnly={disabled}
        />
        {ac.loading && (
          <Loader2
            size={15}
            className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--text-muted)" }}
          />
        )}
      </div>
      {ac.showDropdown && ac.suggestions.length > 0 && (
        <div
          className="absolute z-[1000] left-0 right-0 mt-1 rounded-lg py-1 shadow-lg max-h-48 overflow-auto"
          style={{ background: "var(--bg-dropdown)", border: "1px solid var(--border-main)" }}
        >
          {ac.suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3 py-2 text-[12px] border-none cursor-pointer"
              style={{ background: "transparent", color: "var(--text-primary)" }}
              onMouseDown={() => onSelect(s)}
            >
              <p className="font-medium">{s.placePrediction?.mainText?.text}</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {s.placePrediction?.secondaryText?.text}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RouteStopField({
  label,
  color,
  place,
  isLoaded,
  disabled,
  isActive,
  onActivate,
  onPlace,
  onRemove,
}: {
  label: string;
  color: string;
  place: Place | null;
  isLoaded: boolean;
  disabled?: boolean;
  isActive: boolean;
  onActivate: () => void;
  onPlace: (p: Place) => void;
  onRemove?: () => void;
}) {
  const ac = usePlaceAutocomplete(isLoaded);

  useEffect(() => {
    ac.setQuery(place?.label ?? "");
  }, [place?.label]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectSuggestion = useCallback(async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;

    const name = prediction.mainText?.text ?? prediction.text?.text ?? "";
    ac.setQuery(name);
    ac.setShowDropdown(false);
    ac.resetToken();

    try {
      const gPlace = await prediction.toPlace();
      await gPlace.fetchFields({ fields: ["location", "displayName"] });
      const loc = gPlace.location;
      if (loc) {
        onPlace({ label: name, lat: loc.lat(), lng: loc.lng() });
        return;
      }
    } catch {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: prediction.text?.text ?? name }, (results, status) => {
        if (status === "OK" && results?.[0]) {
          const loc = results[0].geometry.location;
          onPlace({ label: name, lat: loc.lat(), lng: loc.lng() });
        }
      });
    }
  }, [ac, onPlace]);

  return (
    <div
      className="rounded-lg p-2"
      style={{
        background: isActive ? "color-mix(in srgb, var(--nav-active-bg) 40%, transparent)" : "transparent",
        boxShadow: isActive ? "inset 0 0 0 1px var(--border-info-green)" : "none",
      }}
    >
      <PlaceSearchBox
        label={label}
        color={color}
        ac={ac}
        isLoaded={isLoaded}
        disabled={disabled}
        onActivate={onActivate}
        onSelect={selectSuggestion}
        onRemove={onRemove}
      />
    </div>
  );
}

const MAP_LOADING_BOX = (
  <div
    className="w-full flex items-center justify-center text-[12px]"
    style={{ height: 300, borderRadius: "var(--radius-lg)", background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
  >
    กำลังโหลดแผนที่...
  </div>
);

export default function GoogleRoutePicker(props: Props) {
  return (
    <GoogleMapsJsLoader
      loadingFallback={MAP_LOADING_BOX}
      unconfiguredFallback={(
        <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>
          {MAPS_UNAVAILABLE_USER_MESSAGE}
        </p>
      )}
    >
      {({ isLoaded, loadError }) =>
        loadError ? (
          <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>
            {MAPS_UNAVAILABLE_USER_MESSAGE}
          </p>
        ) : (
          <GoogleRoutePickerMaps {...props} isLoaded={isLoaded} />
        )}
    </GoogleMapsJsLoader>
  );
}

function GoogleRoutePickerMaps({
  value,
  onChange,
  hqEnd,
  allowWaypoints = true,
  isLoaded,
}: Props & { isLoaded: boolean }) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const initialOrigin = placeFromValue(value?.origin, value?.originLat, value?.originLng);
  const initialDest = placeFromValue(value?.destination, value?.destLat, value?.destLng);
  const initialWaypoints = (value?.waypoints ?? [])
    .map((w) => placeFromValue(w.label, w.lat, w.lng))
    .filter((p): p is Place => p != null);

  const [origin, setOrigin] = useState<Place | null>(initialOrigin);
  const [dest, setDest] = useState<Place | null>(initialDest);
  const [waypoints, setWaypoints] = useState<(Place | null)[]>(initialWaypoints);
  const [active, setActive] = useState<ActiveStop>(
    initialOrigin && !initialDest ? "destination" : "origin",
  );
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [hqLocked, setHqLocked] = useState(hqEnd === "origin");

  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    setOrigin(placeFromValue(value?.origin, value?.originLat, value?.originLng));
    setDest(placeFromValue(value?.destination, value?.destLat, value?.destLng));
  }, [
    value?.origin, value?.originLat, value?.originLng,
    value?.destination, value?.destLat, value?.destLng,
  ]);

  const valueWaypointsKey = JSON.stringify(value?.waypoints ?? []);
  useEffect(() => {
    setWaypoints(
      (value?.waypoints ?? [])
        .map((w) => placeFromValue(w.label, w.lat, w.lng))
        .filter((p): p is Place => p != null),
    );
  }, [valueWaypointsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const validWaypoints = useCallback((wps: (Place | null)[]) => {
    return wps.filter((w): w is Place => w != null && isValidCoord(w.lat, w.lng));
  }, []);

  const emit = useCallback(
    (o: Place | null, wps: (Place | null)[], d: Place | null, km: number) => {
      if (!o || !d) return;
      const stops = allowWaypoints ? validWaypoints(wps) : [];
      onChange({
        origin: o.label,
        originLat: o.lat,
        originLng: o.lng,
        destination: d.label,
        destLat: d.lat,
        destLng: d.lng,
        distanceKm: km,
        waypoints: stops.length > 0 ? stops.map((w) => ({ label: w.label, lat: w.lat, lng: w.lng })) : undefined,
      });
    },
    [onChange, validWaypoints, allowWaypoints],
  );

  const focusPlace = useCallback((place: Place | null) => {
    const map = mapRef.current;
    if (!map || !place || !isValidCoord(place.lat, place.lng)) return;
    map.panTo({ lat: place.lat, lng: place.lng });
    if (map.getZoom()! < 14) map.setZoom(14);
  }, []);

  const nextActiveAfter = useCallback((current: ActiveStop, wps: (Place | null)[]): ActiveStop => {
    if (current === "origin") return "destination";
    if (current === "destination") return wps.length > 0 ? 0 : "destination";
    if (typeof current === "number") {
      return current < wps.length - 1 ? current + 1 : current;
    }
    return "destination";
  }, []);

  const setWaypointAt = useCallback((index: number, place: Place) => {
    setWaypoints((prev) => {
      const next = Array.from(prev);
      while (next.length <= index) next.push(null);
      next[index] = place;
      setActive(index < next.length - 1 ? index + 1 : "destination");
      return next;
    });
    focusPlace(place);
  }, [focusPlace]);

  const calculateRoute = useCallback(async () => {
    if (!origin || !dest || !isLoaded) return;
    const extras = allowWaypoints ? validWaypoints(waypoints) : [];
    const allDests = [dest, ...extras];
    const finalDest = allDests[allDests.length - 1];
    const via = allDests.slice(0, -1);
    setCalculating(true);
    setError(null);
    const directionsService = new google.maps.DirectionsService();
    try {
      const result = await directionsService.route({
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: finalDest.lat, lng: finalDest.lng },
        waypoints: via.map((w) => ({
          location: { lat: w.lat, lng: w.lng },
          stopover: true,
        })),
        travelMode: google.maps.TravelMode.DRIVING,
      });
      setDirections(result);
      const legs = result.routes[0]?.legs ?? [];
      const meters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
      const distanceKm = Math.round((meters / 1000) * 10) / 10;
      emit(origin, waypoints, dest, distanceKm);
      if (mapRef.current && result.routes[0]?.bounds) {
        mapRef.current.fitBounds(result.routes[0].bounds);
      }
    } catch {
      setDirections(null);
      setError("คำนวณเส้นทางไม่ได้ — ลองเลือกสถานที่ใหม่");
    } finally {
      setCalculating(false);
    }
  }, [origin, dest, isLoaded, waypoints, emit, validWaypoints, allowWaypoints]);

  useEffect(() => {
    if (origin && dest) calculateRoute();
  }, [origin, dest, waypoints]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    const cur = activeRef.current;
    if (hqEnd === "origin" && hqLocked && cur === "origin") return;
    const p: Place = {
      label: `ปักหมุด (${e.latLng.lat().toFixed(5)}, ${e.latLng.lng().toFixed(5)})`,
      lat: e.latLng.lat(),
      lng: e.latLng.lng(),
    };
    if (cur === "origin") {
      setOrigin(p);
      setActive(nextActiveAfter("origin", waypoints));
    } else if (cur === "destination") {
      setDest(p);
    } else if (typeof cur === "number") {
      setWaypointAt(cur, p);
    }
    focusPlace(p);
  }, [focusPlace, hqEnd, hqLocked, nextActiveAfter, setWaypointAt, waypoints]);

  const handleReset = useCallback(() => {
    if (hqEnd !== "origin" && hqEnd !== "destination") {
      setOrigin(null);
      setDest(null);
      setWaypoints([]);
      setActive("origin");
      setDirections(null);
      setError(null);
      onChange(null);
      return;
    }
    const hq: Place = {
      label: OFFICE_LOCATION.label,
      lat: OFFICE_LOCATION.lat,
      lng: OFFICE_LOCATION.lng,
    };
    const nextOrigin = hqEnd === "origin" ? hq : null;
    const nextDest = hqEnd === "destination" ? hq : null;
    const nextActive: ActiveStop = hqEnd === "origin" ? "destination" : "origin";

    setOrigin(nextOrigin);
    setDest(nextDest);
    setWaypoints([]);
    setActive(nextActive);
    setDirections(null);
    setError(null);
    if (hqEnd === "origin") setHqLocked(true);

    if (hqEnd === "origin") {
      onChange({
        origin: hq.label,
        originLat: hq.lat,
        originLng: hq.lng,
        destination: "",
        destLat: 0,
        destLng: 0,
        distanceKm: 0,
        waypoints: undefined,
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
        waypoints: undefined,
      });
    }
    focusPlace(hq);
  }, [hqEnd, onChange, focusPlace]);

  const handleCenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (directions?.routes[0]?.bounds) {
      map.fitBounds(directions.routes[0].bounds);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    if (origin && isValidCoord(origin.lat, origin.lng)) bounds.extend({ lat: origin.lat, lng: origin.lng });
    for (const w of validWaypoints(waypoints)) bounds.extend({ lat: w.lat, lng: w.lng });
    if (dest && isValidCoord(dest.lat, dest.lng)) bounds.extend({ lat: dest.lat, lng: dest.lng });
    if (!bounds.isEmpty()) map.fitBounds(bounds, 30);
  }, [origin, dest, directions, waypoints, validWaypoints]);

  const applyHqOrigin = useCallback(() => {
    const hq: Place = {
      label: OFFICE_LOCATION.label,
      lat: OFFICE_LOCATION.lat,
      lng: OFFICE_LOCATION.lng,
    };
    setOrigin(hq);
    setActive(waypoints.length > 0 ? 0 : "destination");
    const stops = validWaypoints(waypoints);
    onChange({
      origin: hq.label,
      originLat: hq.lat,
      originLng: hq.lng,
      destination: dest?.label ?? "",
      destLat: dest?.lat ?? 0,
      destLng: dest?.lng ?? 0,
      distanceKm: value?.distanceKm ?? 0,
      waypoints: stops.length > 0 ? stops.map((w) => ({ label: w.label, lat: w.lat, lng: w.lng })) : undefined,
    });
    focusPlace(hq);
  }, [dest, focusPlace, onChange, value?.distanceKm, waypoints, validWaypoints]);

  const toggleHqLocked = useCallback(() => {
    if (hqLocked) {
      setHqLocked(false);
      setActive("origin");
    } else {
      setHqLocked(true);
      applyHqOrigin();
    }
  }, [hqLocked, applyHqOrigin]);

  const addWaypoint = useCallback(() => {
    setWaypoints((prev) => {
      const next = [...prev, null];
      setActive(next.length - 1);
      return next;
    });
  }, []);

  const removeWaypoint = useCallback((index: number) => {
    setWaypoints((prev) => prev.filter((_, i) => i !== index));
    setActive((cur) => {
      if (typeof cur === "number") {
        if (cur === index) return "origin";
        if (cur > index) return cur - 1;
      }
      return cur;
    });
  }, []);

  const routeStops = useMemo(
    () => buildRouteStopChain(origin, dest, validWaypoints(waypoints), allowWaypoints),
    [origin, dest, waypoints, allowWaypoints, validWaypoints],
  );

  const isActiveStop = (stop: ActiveStop) => active === stop;

  const hasAnyPin =
    (origin != null && isValidCoord(origin.lat, origin.lng))
    || validWaypoints(waypoints).length > 0
    || (dest != null && isValidCoord(dest.lat, dest.lng));

  if (!isLoaded) {
    return MAP_LOADING_BOX;
  }

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

      <div className="flex flex-col gap-2">
        <RouteStopField
          label={ROUTE_ORIGIN_LABEL}
          color="var(--color-success)"
          place={origin}
          isLoaded={isLoaded}
          disabled={hqEnd === "origin" && hqLocked}
          isActive={isActiveStop("origin")}
          onActivate={() => { setActive("origin"); focusPlace(origin); }}
          onPlace={(p) => {
            setOrigin(p);
            setActive(nextActiveAfter("origin", waypoints));
            focusPlace(p);
          }}
        />

        <RouteStopField
          label={ROUTE_FIRST_DEST_LABEL}
          color="var(--color-danger)"
          place={dest}
          isLoaded={isLoaded}
          isActive={isActiveStop("destination")}
          onActivate={() => { setActive("destination"); focusPlace(dest); }}
          onPlace={(p) => {
            setDest(p);
            setActive(nextActiveAfter("destination", waypoints));
            focusPlace(p);
          }}
        />

        {allowWaypoints && waypoints.map((wp, i) => (
          <RouteStopField
            key={i}
            label={extraDestinationLabel(i)}
            color="#d97706"
            place={wp}
            isLoaded={isLoaded}
            isActive={isActiveStop(i)}
            onActivate={() => { setActive(i); focusPlace(wp); }}
            onPlace={(p) => setWaypointAt(i, p)}
            onRemove={() => removeWaypoint(i)}
          />
        ))}
      </div>

      {allowWaypoints && (
      <button
        type="button"
        onClick={addWaypoint}
        className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-none"
        style={{ background: "var(--bg-card-alt)", color: "var(--text-secondary)", boxShadow: "inset 0 0 0 1px var(--border-light)" }}
      >
        <Plus size={14} /> เพิ่มจุดแวะ
      </button>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <span>คลิกแผนที่เพื่อปัก:</span>
        <button
          type="button"
          className="px-2 py-0.5 rounded-full"
          style={{
            background: isActiveStop("origin") ? "var(--bg-info-green)" : "transparent",
            color: isActiveStop("origin") ? "var(--text-info-green)" : "var(--text-muted)",
            border: "1px solid var(--border-light)",
            opacity: hqEnd === "origin" && hqLocked ? 0.45 : 1,
          }}
          disabled={hqEnd === "origin" && hqLocked}
          onClick={() => { setActive("origin"); focusPlace(origin); }}
        >
          {ROUTE_ORIGIN_LABEL}
        </button>
        <button
          type="button"
          className="px-2 py-0.5 rounded-full"
          style={{
            background: isActiveStop("destination") ? "var(--bg-info-green)" : "transparent",
            color: isActiveStop("destination") ? "var(--text-info-green)" : "var(--text-muted)",
            border: "1px solid var(--border-light)",
          }}
          onClick={() => { setActive("destination"); focusPlace(dest); }}
        >
          {ROUTE_FIRST_DEST_LABEL}
        </button>
        {allowWaypoints && waypoints.map((_, i) => (
          <button
            key={i}
            type="button"
            className="px-2 py-0.5 rounded-full"
            style={{
              background: isActiveStop(i) ? "var(--bg-info-green)" : "transparent",
              color: isActiveStop(i) ? "var(--text-info-green)" : "var(--text-muted)",
              border: "1px solid var(--border-light)",
            }}
            onClick={() => { setActive(i); focusPlace(waypoints[i]); }}
          >
            {extraDestinationLabel(i)}
          </button>
        ))}
        {(hasAnyPin || origin || dest) && (
          <div className="ml-auto flex items-center gap-3">
            {hasAnyPin && (
              <button type="button" className="inline-flex items-center gap-1" style={{ color: "var(--text-muted)" }} onClick={handleCenter}>
                <Crosshair size={11} /> ดูหมุด
              </button>
            )}
            <button type="button" className="inline-flex items-center gap-1" style={{ color: "var(--text-muted)" }} onClick={handleReset}>
              <RotateCcw size={11} /> ล้าง
            </button>
          </div>
        )}
      </div>

      <GoogleMap
        mapContainerStyle={GOOGLE_MAP_CONTAINER}
        center={BANGKOK_CENTER}
        zoom={11}
        options={GOOGLE_MAP_OPTIONS}
        onLoad={(map) => { mapRef.current = map; }}
        onClick={handleMapClick}
      >
        {routeStops.map((stop, i) => (
          <Marker key={i} position={{ lat: stop.lat, lng: stop.lng }} label={stop.label} />
        ))}
        {directions && (
          <DirectionsRenderer directions={directions} options={{ suppressMarkers: true }} />
        )}
      </GoogleMap>

      {calculating && (
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>กำลังคำนวณเส้นทาง...</p>
      )}

      {value && value.distanceKm > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-bold"
          style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}
        >
          ระยะทาง: {value.distanceKm} กม.
          {allowWaypoints && validWaypoints(waypoints).length > 0 && (
            <span className="text-[11px] font-normal opacity-80">
              (+{validWaypoints(waypoints).length} ปลายทาง)
            </span>
          )}
        </div>
      )}

      {error && <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>{error}</p>}
    </div>
  );
}
