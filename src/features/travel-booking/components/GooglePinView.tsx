"use client";

import { GoogleMap, Marker } from "@react-google-maps/api";
import { GoogleMapsJsLoader } from "@/components/maps/GoogleMapsJsLoader";
import { GOOGLE_MAP_OPTIONS } from "@/lib/google-maps-constants";

/**
 * A read-only map with one pin per work location.
 *
 * `GoogleRouteView` minus the route: same loader, same read-only option
 * overrides, and no `DirectionsService`, so unlike AP-1's this fires no request
 * of its own when it renders — the coordinates were captured once, when the
 * requester picked the place.
 *
 * **It renders nothing rather than something wrong.** A work location has
 * coordinates only if somebody picked it from Google after 2026-09-01; a place
 * typed by hand, and every row stored before then, has none and can never get
 * any — the Google key is HTTP-referrer restricted, so no server-side backfill
 * is possible. With no usable point this returns null and the detail page shows
 * the place names alone, which is what it showed before this existed.
 */

export interface PinPlace {
  name: string;
  lat: number | null;
  lng: number | null;
}

/** Both finite, and not the (0,0) null island — a real point off West Africa. */
function usable(p: PinPlace): p is PinPlace & { lat: number; lng: number } {
  return (
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    !(p.lat === 0 && p.lng === 0)
  );
}

function MapLoading({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center text-[11px]"
      style={{
        width: "100%",
        height,
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-card-alt)",
        color: "var(--text-muted)",
      }}
    >
      กำลังโหลดแผนที่...
    </div>
  );
}

export function GooglePinView({
  places,
  height = 220,
}: {
  places: PinPlace[];
  height?: number;
}) {
  const pins = places.filter(usable);
  if (pins.length === 0) return null;

  return (
    <GoogleMapsJsLoader
      loadingFallback={<MapLoading height={height} />}
      // No key configured: the place names above the map already say where the
      // trip goes, so an empty box would add nothing.
      unconfiguredFallback={null}
    >
      {({ isLoaded }) =>
        isLoaded ? <PinMap pins={pins} height={height} /> : <MapLoading height={height} />
      }
    </GoogleMapsJsLoader>
  );
}

function PinMap({
  pins,
  height,
}: {
  pins: (PinPlace & { lat: number; lng: number })[];
  height: number;
}) {
  return (
    <GoogleMap
      mapContainerStyle={{ width: "100%", height, borderRadius: "var(--radius-lg)" }}
      // Centred on the first pin rather than on Bangkok: this map exists to show
      // one place, and a London trip opening on Thailand would be worse than no
      // map. `fitBounds` is deliberately not used for the single-pin case, which
      // is every case today — it zooms to a point and picks its own level.
      center={{ lat: pins[0].lat, lng: pins[0].lng }}
      zoom={15}
      options={{
        ...GOOGLE_MAP_OPTIONS,
        zoomControl: false,
        gestureHandling: "none",
        draggable: false,
        scrollwheel: false,
        disableDoubleClickZoom: true,
      }}
      onLoad={(map) => {
        // More than one pin is possible in the schema even though the form
        // writes one today, so fit them all when there are several.
        if (pins.length < 2) return;
        const bounds = new google.maps.LatLngBounds();
        for (const p of pins) bounds.extend({ lat: p.lat, lng: p.lng });
        map.fitBounds(bounds, 48);
      }}
    >
      {pins.map((p, i) => (
        <Marker key={i} position={{ lat: p.lat, lng: p.lng }} title={p.name} />
      ))}
    </GoogleMap>
  );
}
