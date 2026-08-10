"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, DirectionsRenderer, Marker } from "@react-google-maps/api";
import { GoogleMapsJsLoader } from "@/components/maps/GoogleMapsJsLoader";
import { buildRouteStopChain } from "@/features/accounting/lib/route-waypoints";
import type { RouteWaypoint } from "@/features/accounting/types";
import {
  BANGKOK_CENTER,
  GOOGLE_MAP_OPTIONS,
} from "@/lib/google-maps-constants";

interface Point {
  lat: number;
  lng: number;
}

interface Props {
  origin: Point;
  dest: Point;
  waypoints?: RouteWaypoint[] | null;
  height?: number;
}

function MapLoading({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center text-[11px]"
      style={{ width: "100%", height, borderRadius: "var(--radius-lg)", background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
    >
      กำลังโหลดแผนที่...
    </div>
  );
}

/** Read-only Google Map: driving route through all stops. */
export default function GoogleRouteView({ origin, dest, waypoints, height = 220 }: Props) {
  const stops = useMemo(
    () => buildRouteStopChain(origin, dest, waypoints ?? null, true),
    [origin, dest, waypoints],
  );

  if (stops.length < 2) return null;

  return (
    <GoogleMapsJsLoader loadingFallback={<MapLoading height={height} />}>
      {({ isLoaded }) => (
        <GoogleRouteViewMap stops={stops} height={height} isLoaded={isLoaded} />
      )}
    </GoogleMapsJsLoader>
  );
}

function GoogleRouteViewMap({
  stops,
  height = 220,
  isLoaded,
}: {
  stops: ReturnType<typeof buildRouteStopChain>;
  height?: number;
  isLoaded: boolean;
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);

  useEffect(() => {
    if (!isLoaded || stops.length < 2) return;
    let cancelled = false;
    const svc = new google.maps.DirectionsService();
    const final = stops[stops.length - 1];
    const via = stops.slice(1, -1);
    svc.route(
      {
        origin: { lat: stops[0].lat, lng: stops[0].lng },
        destination: { lat: final.lat, lng: final.lng },
        waypoints: via.map((s) => ({
          location: { lat: s.lat, lng: s.lng },
          stopover: true,
        })),
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (cancelled) return;
        if (status === "OK" && result) {
          setDirections(result);
          if (mapRef.current && result.routes[0]?.bounds) {
            mapRef.current.fitBounds(result.routes[0].bounds);
          }
        }
      },
    );
    return () => { cancelled = true; };
  }, [isLoaded, stops]);

  if (!isLoaded) return <MapLoading height={height} />;

  return (
    <GoogleMap
      mapContainerStyle={{ width: "100%", height, borderRadius: "var(--radius-lg)" }}
      center={BANGKOK_CENTER}
      zoom={12}
      options={{
        ...GOOGLE_MAP_OPTIONS,
        zoomControl: false,
        gestureHandling: "none",
        draggable: false,
        scrollwheel: false,
        disableDoubleClickZoom: true,
      }}
      onLoad={(map) => { mapRef.current = map; }}
    >
      {stops.map((stop, i) => (
        <Marker key={i} position={{ lat: stop.lat, lng: stop.lng }} label={stop.label} />
      ))}
      {directions && (
        <DirectionsRenderer directions={directions} options={{ suppressMarkers: true }} />
      )}
    </GoogleMap>
  );
}
