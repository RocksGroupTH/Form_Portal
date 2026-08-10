import { testGoogleMapsKey, GoogleMapsReferrerRestrictedError, resolveGoogleMapsKey } from "@/lib/google-maps";

export type MapProvider = "google" | null;

export interface ProviderKeyStatus {
  configured: boolean;
  source: "db" | "env" | null;
}

export interface MapProviderStatus {
  google: ProviderKeyStatus & { ready: boolean };
  /** AP-1 travel expense uses Google Maps when a key is configured. */
  activeProvider: MapProvider;
}

type ReadyCache = { ready: boolean; ts: number };
let googleReadyCache: ReadyCache | null = null;
const READY_TTL_MS = 90_000;

async function probeGoogleReady(configured: boolean): Promise<boolean> {
  if (!configured) return false;
  const now = Date.now();
  if (googleReadyCache && now - googleReadyCache.ts < READY_TTL_MS) {
    return googleReadyCache.ready;
  }
  let ready = false;
  try {
    await testGoogleMapsKey();
    ready = true;
  } catch (e) {
    ready = e instanceof GoogleMapsReferrerRestrictedError;
  }
  googleReadyCache = { ready, ts: now };
  return ready;
}

/** Clear cached Google readiness (e.g. after saving a new key). */
export function invalidateGoogleReadyCache(): void {
  googleReadyCache = null;
}

export async function resolveMapProviderStatus(): Promise<MapProviderStatus> {
  const { key: googleKey, source: googleSource } = await resolveGoogleMapsKey();

  const googleConfigured = !!googleKey;
  const googleReady = await probeGoogleReady(googleConfigured);

  return {
    google: {
      configured: googleConfigured,
      ready: googleReady,
      source: googleConfigured ? googleSource : null,
    },
    activeProvider: googleConfigured ? "google" : null,
  };
}
