import { resolveApiKey } from "@/lib/api-keys/service";

const ORS_BASE = "https://api.openrouteservice.org";
/** Bias geocoding toward Thailand / Bangkok. */
const FOCUS = { lat: 13.7563, lon: 100.5018 };

export interface OrsPlace {
  label: string;
  lat: number;
  lng: number;
  /** Province/state of the place (Pelias `properties.region`) — used to auto-fill จังหวัด. */
  region?: string | null;
}

export interface OrsRoute {
  /** Driving distance in kilometres (1 decimal). */
  distanceKm: number;
  /** Route polyline as [lat, lng] pairs for Leaflet. */
  polyline: [number, number][];
}

/**
 * Resolve the ORS key through the shared registry: Settings → API Keys first,
 * then the old `Fast_Core.AppSetting` row, then env. A read failure at any step
 * must NOT break the fallback below it — `resolveApiKey` swallows and carries
 * on, which is what keeps routing working through a database outage.
 * Reports `"db"` for either stored source; that signal only distinguishes
 * "stored" from "in a file".
 */
export async function resolveOrsKey(): Promise<{ key: string | null; source: "db" | "env" | null }> {
  const { value, source } = await resolveApiKey("ORS_API_KEY");
  if (!value) return { key: null, source: null };
  return { key: value, source: source === "env" ? "env" : "db" };
}

async function requireKey(): Promise<string> {
  const { key } = await resolveOrsKey();
  if (!key) throw new Error("ORS_API_KEY is not configured");
  return key;
}

/** Autocomplete place search (ORS / Pelias). Returns up to ~6 suggestions. */
export async function orsGeocode(text: string): Promise<OrsPlace[]> {
  const q = text.trim();
  if (q.length < 2) return [];
  const key = await requireKey();
  const url =
    `${ORS_BASE}/geocode/autocomplete` +
    `?api_key=${encodeURIComponent(key)}` +
    `&text=${encodeURIComponent(q)}` +
    `&boundary.country=TH` +
    `&focus.point.lat=${FOCUS.lat}&focus.point.lon=${FOCUS.lon}` +
    `&size=6`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ORS geocode failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: { properties?: { label?: string; region?: string }; geometry?: { coordinates?: [number, number] } }[];
  };
  const out: OrsPlace[] = [];
  for (const f of json.features ?? []) {
    const coords = f.geometry?.coordinates; // [lng, lat]
    const label = f.properties?.label;
    if (coords && label) out.push({ label, region: f.properties?.region ?? null, lng: coords[0], lat: coords[1] });
  }
  return out;
}

/**
 * Full-text place search (ORS / Pelias `/geocode/search`). Unlike autocomplete (prefix
 * matching), this matches the query anywhere in a place's name — so "เชียงใหม่" finds
 * "ท่าอากาศยานนานาชาติเชียงใหม่". Better recall for loose keywords.
 */
/** Thai colloquial → official name synonyms (Pelias indexes official names). One term
 *  can expand to several official forms; every form is searched and the results merged. */
const PLACE_SYNONYMS: { term: string; officials: string[] }[] = [
  { term: "สนามบิน", officials: ["ท่าอากาศยาน", "ท่าอากาศยานนานาชาติ"] },
  { term: "บขส", officials: ["สถานีขนส่งผู้โดยสาร"] },
  { term: "หมอชิต", officials: ["สถานีขนส่งผู้โดยสารกรุงเทพ (จตุจักร)"] },
];

export async function orsSearch(text: string): Promise<OrsPlace[]> {
  const q = text.trim();
  if (q.length < 2) return [];
  const key = await requireKey();

  // Search the query plus any synonym-expanded variants, then merge — so "สนามบินเชียงใหม่"
  // also finds the officially-named "ท่าอากาศยานนานาชาติเชียงใหม่".
  const variants: string[] = [q];
  for (const { term, officials } of PLACE_SYNONYMS) {
    if (q.indexOf(term) >= 0) {
      for (const official of officials) {
        const expanded = q.split(term).join(official);
        if (expanded !== q && variants.indexOf(expanded) < 0) variants.push(expanded);
      }
    }
  }

  const common =
    `?api_key=${encodeURIComponent(key)}` +
    `&boundary.country=TH` +
    `&focus.point.lat=${FOCUS.lat}&focus.point.lon=${FOCUS.lon}` +
    // POIs/addresses over whole cities, so a bare name surfaces venues (the mall/airport).
    `&layers=venue,address,street,neighbourhood`;

  // Query full-text `search` for every synonym variant (matches a word anywhere) AND
  // `autocomplete` for the base query (prefix match) — merged, they cover far more POIs
  // (e.g. "เมญ่า" as the start of "เมญ่า ไลฟ์สไตล์ ช้อปปิ้ง เซ็นเตอร์").
  const urls: string[] = [
    ...variants.map((t) => `${ORS_BASE}/geocode/search${common}&text=${encodeURIComponent(t)}&size=40`),
    `${ORS_BASE}/geocode/autocomplete${common}&text=${encodeURIComponent(q)}&size=10`,
  ];

  const lists = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return [] as OrsPlace[];
        const json = (await res.json()) as {
          features?: { properties?: { label?: string; region?: string }; geometry?: { coordinates?: [number, number] } }[];
        };
        const parsed: OrsPlace[] = [];
        for (const f of json.features ?? []) {
          const coords = f.geometry?.coordinates; // [lng, lat]
          const label = f.properties?.label;
          if (coords && label) parsed.push({ label, region: f.properties?.region ?? null, lng: coords[0], lat: coords[1] });
        }
        return parsed;
      } catch {
        return [] as OrsPlace[];
      }
    }),
  );

  // Merge, dedupe by label (synonym-expanded / autocomplete hits first for better recall).
  const seen = new Set<string>();
  const out: OrsPlace[] = [];
  for (const list of lists.reverse()) {
    for (const p of list) {
      if (seen.has(p.label)) continue;
      seen.add(p.label);
      out.push(p);
    }
  }
  return out;
}

/** Driving route between two points. origin/dest are {lat,lng}. */
export async function orsRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<OrsRoute> {
  const key = await requireKey();
  const res = await fetch(`${ORS_BASE}/v2/directions/driving-car/geojson`, {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
      // The /geojson endpoint produces application/geo+json — Accept must allow it,
      // otherwise ORS returns 406 Not Acceptable.
      Accept: "application/geo+json, application/json",
    },
    body: JSON.stringify({
      coordinates: [
        [origin.lng, origin.lat],
        [destination.lng, destination.lat],
      ],
    }),
  });
  if (!res.ok) throw new Error(`ORS directions failed: ${res.status}`);
  const json = (await res.json()) as {
    features?: {
      properties?: { summary?: { distance?: number } };
      geometry?: { coordinates?: [number, number][] };
    }[];
  };
  const feat = json.features?.[0];
  const meters = feat?.properties?.summary?.distance ?? 0;
  const polyline: [number, number][] = (feat?.geometry?.coordinates ?? []).map(
    ([lng, lat]) => [lat, lng],
  );
  return { distanceKm: Math.round((meters / 1000) * 10) / 10, polyline };
}
