import type { RouteWaypoint } from "../types";

export function parseRouteWaypoints(json: unknown): RouteWaypoint[] | null {
  if (json == null || json === "") return null;
  if (typeof json !== "string") return null;
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return null;
    const out: RouteWaypoint[] = [];
    for (const w of raw) {
      if (!w || typeof w.label !== "string") continue;
      const lat = Number(w.lat);
      const lng = Number(w.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({ label: w.label, lat, lng });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function serializeRouteWaypoints(wps: RouteWaypoint[] | null | undefined): string | null {
  if (!wps || wps.length === 0) return null;
  return JSON.stringify(wps.map((w) => ({ label: w.label, lat: w.lat, lng: w.lng })));
}

export function waypointLetter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  return String(index + 1);
}

export function waypointLabel(index: number): string {
  return `จุด ${waypointLetter(index)}`;
}

export const ROUTE_ORIGIN_LABEL = "ต้นทาง A";
export const ROUTE_FIRST_DEST_LABEL = "ปลายทาง B";

export interface RouteMapStop {
  label: string;
  lat: number;
  lng: number;
}

function isValidRouteCoord(lat: number, lng: number): boolean {
  if (lat === 0 && lng === 0) return false;
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Ordered map pins: A (origin) → B (first dest) → C, D, E… */
export function buildRouteStopChain(
  origin: { lat: number; lng: number } | null | undefined,
  firstDest: { lat: number; lng: number } | null | undefined,
  extraWaypoints?: RouteWaypoint[] | null,
  includeExtras = true,
): RouteMapStop[] {
  const chain: RouteMapStop[] = [];
  let idx = 0;
  if (origin && isValidRouteCoord(origin.lat, origin.lng)) {
    chain.push({ label: waypointLetter(idx++), lat: origin.lat, lng: origin.lng });
  }
  if (firstDest && isValidRouteCoord(firstDest.lat, firstDest.lng)) {
    chain.push({ label: waypointLetter(idx++), lat: firstDest.lat, lng: firstDest.lng });
  }
  if (includeExtras) {
    for (const w of extraWaypoints ?? []) {
      if (w?.label && isValidRouteCoord(w.lat, w.lng)) {
        chain.push({ label: waypointLetter(idx++), lat: w.lat, lng: w.lng });
      }
    }
  }
  return chain;
}

/** Extra destinations after the first ปลายทาง — C, D, E… */
export function extraDestinationLabel(index: number): string {
  return `ปลายทาง ${waypointLetter(index + 2)}`;
}

/** Ordered stops after origin: first ปลายทาง, then C, D, E… */
export function getOnwardDestinationChain(day: {
  onwardDestination: string | null;
  onwardDestLat: number | null;
  onwardDestLng: number | null;
  onwardWaypoints?: RouteWaypoint[] | null;
}): RouteWaypoint[] {
  const chain: RouteWaypoint[] = [];
  if (
    day.onwardDestination?.trim()
    && day.onwardDestLat != null
    && day.onwardDestLng != null
    && !(day.onwardDestLat === 0 && day.onwardDestLng === 0)
  ) {
    chain.push({
      label: day.onwardDestination.trim(),
      lat: day.onwardDestLat,
      lng: day.onwardDestLng,
    });
  }
  for (const w of day.onwardWaypoints ?? []) {
    if (w?.label?.trim() && w.lat != null && w.lng != null) {
      chain.push({ label: w.label.trim(), lat: w.lat, lng: w.lng });
    }
  }
  return chain;
}

/** Last stop on the onward leg (last ปลายทาง, else origin). */
export function getOnwardLastStop(day: {
  onwardOrigin: string | null;
  onwardOriginLat: number | null;
  onwardOriginLng: number | null;
  onwardDestination: string | null;
  onwardDestLat: number | null;
  onwardDestLng: number | null;
  onwardWaypoints?: RouteWaypoint[] | null;
}): RouteWaypoint | null {
  const chain = getOnwardDestinationChain(day);
  if (chain.length > 0) return chain[chain.length - 1];
  if (
    day.onwardOrigin?.trim()
    && day.onwardOriginLat != null
    && day.onwardOriginLng != null
  ) {
    return {
      label: day.onwardOrigin.trim(),
      lat: day.onwardOriginLat,
      lng: day.onwardOriginLng,
    };
  }
  return null;
}

/** Round-trip: seed return origin from the onward leg's last stop. */
export function syncReturnOriginFromOnward<T extends {
  direction: string | null;
  returnOrigin: string | null;
  returnOriginLat: number | null;
  returnOriginLng: number | null;
  onwardOrigin: string | null;
  onwardOriginLat: number | null;
  onwardOriginLng: number | null;
  onwardDestination: string | null;
  onwardDestLat: number | null;
  onwardDestLng: number | null;
  onwardWaypoints?: RouteWaypoint[] | null;
}>(day: T): T {
  if (day.direction !== "round") return day;
  const last = getOnwardLastStop(day);
  if (!last) return day;
  return {
    ...day,
    returnOrigin: last.label,
    returnOriginLat: last.lat,
    returnOriginLng: last.lng,
  };
}
