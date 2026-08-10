"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { GoogleMap, DirectionsRenderer } from "@react-google-maps/api";
import { MapPin, Navigation, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { GoogleMapsJsLoader } from "@/components/maps/GoogleMapsJsLoader";
import {
  BANGKOK_CENTER,
  GOOGLE_MAP_CONTAINER,
  GOOGLE_MAP_OPTIONS,
} from "@/lib/google-maps-constants";

/* ── Types ── */

export interface RouteData {
  origin: string;
  originLat: number;
  originLng: number;
  destination: string;
  destinationLat: number;
  destinationLng: number;
  distanceKm: number;
  distanceText: string;
  durationText: string;
}

interface RoutePickerProps {
  value: RouteData | null;
  onChange: (data: RouteData | null) => void;
  readOnly?: boolean;
}

/* ── Constants ── */

const MAP_CONTAINER = GOOGLE_MAP_CONTAINER;
const MAP_OPTIONS = GOOGLE_MAP_OPTIONS;

const inputClass = "w-full rounded-lg px-3 py-2 text-[13px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

/* ── Place Autocomplete Hook ── */

function usePlaceAutocomplete(isLoaded: boolean) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (input: string) => {
    if (!isLoaded || !input.trim() || input.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      }
      const response = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: sessionTokenRef.current,
        locationBias: { lat: 13.7563, lng: 100.5018, radius: 200000 },
      });
      setSuggestions(response.suggestions || []);
      setShowDropdown(true);
    } catch {
      setSuggestions([]);
    }
  }, [isLoaded]);

  const handleInputChange = useCallback((value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 300);
  }, [search]);

  const resetToken = useCallback(() => {
    sessionTokenRef.current = null;
  }, []);

  return { query, setQuery, suggestions, showDropdown, setShowDropdown, handleInputChange, resetToken };
}

/* ── Component ── */

export function RoutePicker({ value, onChange, readOnly }: RoutePickerProps) {
  return (
    <GoogleMapsJsLoader
      loadingFallback={<p className="text-[12px]" style={{ color: "var(--text-muted)" }}>กำลังโหลดแผนที่...</p>}
      unconfiguredFallback={<p className="text-[12px]" style={{ color: "var(--color-danger)" }}>Google Maps API key not configured</p>}
    >
      {({ isLoaded }) => (
        <RoutePickerMaps value={value} onChange={onChange} readOnly={readOnly} isLoaded={isLoaded} />
      )}
    </GoogleMapsJsLoader>
  );
}

function RoutePickerMaps({
  value,
  onChange,
  readOnly,
  isLoaded,
}: RoutePickerProps & { isLoaded: boolean }) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Origin autocomplete
  const origin = usePlaceAutocomplete(isLoaded);
  const [originPlace, setOriginPlace] = useState<{ lat: number; lng: number; name: string } | null>(
    value ? { lat: value.originLat, lng: value.originLng, name: value.origin } : null
  );

  // Destination autocomplete
  const dest = usePlaceAutocomplete(isLoaded);
  const [destPlace, setDestPlace] = useState<{ lat: number; lng: number; name: string } | null>(
    value ? { lat: value.destinationLat, lng: value.destinationLng, name: value.destination } : null
  );

  // Init queries from value
  useEffect(() => {
    if (value) {
      origin.setQuery(value.origin);
      dest.setQuery(value.destination);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPlace = useCallback(async (
    suggestion: google.maps.places.AutocompleteSuggestion,
    target: "origin" | "destination",
  ) => {
    const ac = target === "origin" ? origin : dest;
    const setPlace = target === "origin" ? setOriginPlace : setDestPlace;

    const placePrediction = suggestion.placePrediction;
    if (!placePrediction) return;

    const name = placePrediction.mainText?.text ?? placePrediction.text?.text ?? "";
    ac.setQuery(name);
    ac.setShowDropdown(false);
    ac.resetToken();

    try {
      const place = await placePrediction.toPlace();
      await place.fetchFields({ fields: ["location"] });
      const loc = place.location;
      if (loc) {
        setPlace({ lat: loc.lat(), lng: loc.lng(), name });
      }
    } catch {
      // Fallback: geocode
      const geocoder = new google.maps.Geocoder();
      const fullText = placePrediction.text?.text ?? name;
      geocoder.geocode({ address: fullText }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          const loc = results[0].geometry.location;
          setPlace({ lat: loc.lat(), lng: loc.lng(), name });
        }
      });
    }
  }, [origin, dest]);

  // Calculate route when both places are set
  const calculateRoute = useCallback(async () => {
    if (!originPlace || !destPlace || !isLoaded) return;
    setCalculating(true);

    const directionsService = new google.maps.DirectionsService();
    try {
      const result = await directionsService.route({
        origin: { lat: originPlace.lat, lng: originPlace.lng },
        destination: { lat: destPlace.lat, lng: destPlace.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      });

      setDirections(result);

      const leg = result.routes[0]?.legs[0];
      if (leg) {
        const distanceKm = Math.round(((leg.distance?.value ?? 0) / 1000) * 10) / 10;
        const routeData: RouteData = {
          origin: originPlace.name,
          originLat: originPlace.lat,
          originLng: originPlace.lng,
          destination: destPlace.name,
          destinationLat: destPlace.lat,
          destinationLng: destPlace.lng,
          distanceKm,
          distanceText: leg.distance?.text ?? `${distanceKm} km`,
          durationText: leg.duration?.text ?? "",
        };
        onChange(routeData);

        // Fit map to route
        if (mapRef.current && result.routes[0]?.bounds) {
          mapRef.current.fitBounds(result.routes[0].bounds);
        }
      }
    } catch {
      setDirections(null);
    } finally {
      setCalculating(false);
    }
  }, [originPlace, destPlace, isLoaded, onChange]);

  // Auto-calculate when both places change
  useEffect(() => {
    if (originPlace && destPlace) {
      calculateRoute();
    }
  }, [originPlace, destPlace]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = () => {
    origin.setQuery("");
    dest.setQuery("");
    setOriginPlace(null);
    setDestPlace(null);
    setDirections(null);
    onChange(null);
  };

  /* ── Read-only view ── */
  if (readOnly) {
    if (!value) return <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>No route selected</p>;
    return (
      <div className="rounded-lg p-3" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
        <div className="flex items-start gap-2 mb-2">
          <MapPin size={14} style={{ color: "var(--color-success)" }} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{value.origin}</p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Origin</p>
          </div>
        </div>
        <div className="flex items-start gap-2 mb-2">
          <MapPin size={14} style={{ color: "var(--color-danger)" }} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{value.destination}</p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Destination</p>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
          <span className="text-[13px] font-bold" style={{ color: "var(--nav-active-text)" }}>{value.distanceText}</span>
          {value.durationText && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{value.durationText}</span>}
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>Loading maps...</p>;
  }

  /* ── Editable view ── */
  return (
    <div className="flex flex-col gap-3">
      {/* Origin input */}
      <div className="relative">
        <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
          <MapPin size={12} className="inline mr-1" style={{ color: "var(--color-success)" }} />
          Origin (start)
        </label>
        <input
          className={inputClass}
          style={inputStyle}
          value={origin.query}
          onChange={(e) => origin.handleInputChange(e.target.value)}
          onFocus={() => { if (origin.suggestions.length > 0) origin.setShowDropdown(true); }}
          onBlur={() => setTimeout(() => origin.setShowDropdown(false), 200)}
          placeholder="Search origin location..."
        />
        {origin.showDropdown && origin.suggestions.length > 0 && (
          <div
            className="absolute z-50 left-0 right-0 mt-1 rounded-lg py-1 shadow-lg max-h-48 overflow-auto"
            style={{ background: "var(--bg-dropdown)", border: "1px solid var(--border-main)" }}
          >
            {origin.suggestions.map((s, i) => (
              <button
                key={i}
                className="w-full text-left px-3 py-2 text-[12px] cursor-pointer border-none"
                style={{ background: "transparent", color: "var(--text-primary)" }}
                onMouseDown={() => selectPlace(s, "origin")}
              >
                <p className="font-medium">{s.placePrediction?.mainText?.text}</p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{s.placePrediction?.secondaryText?.text}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Destination input */}
      <div className="relative">
        <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
          <MapPin size={12} className="inline mr-1" style={{ color: "var(--color-danger)" }} />
          Destination
        </label>
        <input
          className={inputClass}
          style={inputStyle}
          value={dest.query}
          onChange={(e) => dest.handleInputChange(e.target.value)}
          onFocus={() => { if (dest.suggestions.length > 0) dest.setShowDropdown(true); }}
          onBlur={() => setTimeout(() => dest.setShowDropdown(false), 200)}
          placeholder="Search destination..."
        />
        {dest.showDropdown && dest.suggestions.length > 0 && (
          <div
            className="absolute z-50 left-0 right-0 mt-1 rounded-lg py-1 shadow-lg max-h-48 overflow-auto"
            style={{ background: "var(--bg-dropdown)", border: "1px solid var(--border-main)" }}
          >
            {dest.suggestions.map((s, i) => (
              <button
                key={i}
                className="w-full text-left px-3 py-2 text-[12px] cursor-pointer border-none"
                style={{ background: "transparent", color: "var(--text-primary)" }}
                onMouseDown={() => selectPlace(s, "destination")}
              >
                <p className="font-medium">{s.placePrediction?.mainText?.text}</p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{s.placePrediction?.secondaryText?.text}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Result bar */}
      {value && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "var(--bg-info-green)", border: "1px solid var(--border-info-green)" }}>
          <Navigation size={14} style={{ color: "var(--text-info-green)" }} />
          <div className="flex-1">
            <span className="text-[13px] font-bold" style={{ color: "var(--text-info-green)" }}>{value.distanceText}</span>
            {value.durationText && (
              <span className="text-[11px] ml-2" style={{ color: "var(--text-info-green)", opacity: 0.8 }}>({value.durationText})</span>
            )}
          </div>
          <Button variant="ghost" size="sm" icon={<RotateCcw size={12} />} onClick={handleReset}>
            Reset
          </Button>
        </div>
      )}

      {calculating && (
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>Calculating route...</p>
      )}

      {/* Map */}
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER}
        center={BANGKOK_CENTER}
        zoom={12}
        options={MAP_OPTIONS}
        onLoad={(map) => { mapRef.current = map; }}
      >
        {directions && <DirectionsRenderer directions={directions} options={{ suppressMarkers: false }} />}
      </GoogleMap>
    </div>
  );
}
