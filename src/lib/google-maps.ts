import { resolveApiKey } from "@/lib/api-keys/service";
import {
  GoogleMapsReferrerRestrictedError,
  parseGeocodeTestResponse,
  testGoogleMapsKeyInBrowser,
} from "@/lib/google-maps-client";

export { GoogleMapsReferrerRestrictedError, testGoogleMapsKeyInBrowser };

const GEOCODE_TEST_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Resolve the Google Maps key through the shared registry: Settings → API Keys
 * first, then the old `Fast_Core.AppSetting` row, then env.
 *
 * The middle step is why this move needed no flag day — a key nobody has
 * entered on the new page keeps resolving exactly where it always did. It
 * reports as `"db"` because from an operator's side it is still "stored in the
 * database, not in a file", which is the only distinction this signal drives.
 */
export async function resolveGoogleMapsKey(): Promise<{
  key: string | null;
  source: "db" | "env" | null;
}> {
  const { value, source } = await resolveApiKey("GOOGLE_MAPS_API_KEY");
  if (!value) return { key: null, source: null };
  return { key: value, source: source === "env" ? "env" : "db" };
}

async function requireKey(): Promise<string> {
  const { key } = await resolveGoogleMapsKey();
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not configured");
  return key;
}

/** Server-side smoke test (Geocoding API). Fails for HTTP-referrer-only keys. */
export async function testGoogleMapsKey(): Promise<number> {
  const key = await requireKey();
  const url =
    `${GEOCODE_TEST_URL}?address=${encodeURIComponent("กรุงเทพ")}` +
    `&key=${encodeURIComponent(key)}` +
    `&region=th`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding API failed: ${res.status}`);
  const json = (await res.json()) as Parameters<typeof parseGeocodeTestResponse>[0];
  return parseGeocodeTestResponse(json);
}
