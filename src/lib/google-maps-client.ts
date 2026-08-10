const GEOCODE_TEST_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/** Key is HTTP-referrer restricted — valid in browser, not from server-side REST calls. */
export class GoogleMapsReferrerRestrictedError extends Error {
  constructor() {
    super(
      "API Key จำกัด HTTP referrer — ใช้ได้ในเบราว์เซอร์เท่านั้น (ไม่ใช่จาก server)",
    );
    this.name = "GoogleMapsReferrerRestrictedError";
  }
}

interface GeocodeTestJson {
  status?: string;
  error_message?: string;
  results?: unknown[];
}

export function parseGeocodeTestResponse(json: GeocodeTestJson): number {
  if (json.status === "OK" || json.status === "ZERO_RESULTS") {
    return json.results?.length ?? 0;
  }
  const errMsg = json.error_message ?? "";
  if (json.status === "REQUEST_DENIED" && /referer/i.test(errMsg)) {
    throw new GoogleMapsReferrerRestrictedError();
  }
  const detail = errMsg ? ` — ${errMsg}` : "";
  throw new Error(`Geocoding API: ${json.status ?? "unknown error"}${detail}`);
}

/** Browser-side geocode smoke test (respects HTTP referrer restrictions). */
export async function testGoogleMapsKeyInBrowser(apiKey: string): Promise<number> {
  const key = apiKey.trim();
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not configured");
  const url =
    `${GEOCODE_TEST_URL}?address=${encodeURIComponent("กรุงเทพ")}` +
    `&key=${encodeURIComponent(key)}` +
    `&region=th`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding API failed: ${res.status}`);
  const json = (await res.json()) as GeocodeTestJson;
  return parseGeocodeTestResponse(json);
}
