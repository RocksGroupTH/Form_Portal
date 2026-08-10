"use client";

import { useEffect, useState } from "react";

interface MapsConfig {
  apiKey: string;
  configured: boolean;
  source: "db" | "env" | null;
}

function readEnvMapsKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

/** Load Google Maps browser API key (DB AppSetting with .env fallback). */
export function useGoogleMapsApiKey(): { apiKey: string; loading: boolean; configured: boolean } {
  const [config, setConfig] = useState<MapsConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const envFallback = readEnvMapsKey();

    fetch("/api/maps/config")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: MapsConfig }) => {
        if (cancelled) return;
        if (json.ok && json.data?.apiKey) {
          setConfig(json.data);
        } else if (envFallback) {
          setConfig({ apiKey: envFallback, configured: true, source: "env" });
        } else {
          setConfig({ apiKey: "", configured: false, source: null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (envFallback) {
            setConfig({ apiKey: envFallback, configured: true, source: "env" });
          } else {
            setConfig({ apiKey: "", configured: false, source: null });
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return {
    apiKey: config?.apiKey ?? "",
    loading,
    configured: config?.configured ?? false,
  };
}
