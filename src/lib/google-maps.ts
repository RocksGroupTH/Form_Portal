import { env } from "@/env";
import { getAppSetting } from "@/lib/app-settings";
import {
  GoogleMapsReferrerRestrictedError,
  parseGeocodeTestResponse,
  testGoogleMapsKeyInBrowser,
} from "@/lib/google-maps-client";

export { GoogleMapsReferrerRestrictedError, testGoogleMapsKeyInBrowser };

const GEOCODE_TEST_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/** Resolve Google Maps API key: Fast_Core AppSetting first, then env fallbacks. */
export async function resolveGoogleMapsKey(): Promise<{
  key: string | null;
  source: "db" | "env" | null;
}> {
  let dbKey: string | undefined;
  try {
    dbKey = (await getAppSetting("GOOGLE_MAPS_API_KEY"))?.trim() || undefined;
  } catch {
    dbKey = undefined;
  }
  if (dbKey) return { key: dbKey, source: "db" };

  const publicKey = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (publicKey) return { key: publicKey, source: "env" };

  const serverKey = env.GOOGLE_MAPS_API_KEY?.trim();
  if (serverKey) return { key: serverKey, source: "env" };

  return { key: null, source: null };
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
