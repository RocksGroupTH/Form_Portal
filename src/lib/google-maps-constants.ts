import type { CSSProperties } from "react";

/** Shared loader id so multiple map components reuse one Maps JS script. */
export const GOOGLE_MAPS_LOADER_ID = "rocks-google-maps";

export const GOOGLE_MAPS_LIBRARIES: ("marker" | "places")[] = ["marker", "places"];

export const BANGKOK_CENTER = { lat: 13.7563, lng: 100.5018 };

export const GOOGLE_MAP_CONTAINER: CSSProperties = {
  width: "100%",
  height: "300px",
  borderRadius: "var(--radius-lg)",
};

export const GOOGLE_MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: false,
  gestureHandling: "greedy",
};
