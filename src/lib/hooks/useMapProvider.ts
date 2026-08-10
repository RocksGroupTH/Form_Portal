"use client";

import { useEffect, useState } from "react";
import type { MapProvider, MapProviderStatus } from "@/lib/map-provider";

export function useMapProvider(): {
  status: MapProviderStatus | null;
  provider: MapProvider;
  loading: boolean;
} {
  const [status, setStatus] = useState<MapProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/maps/status")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: MapProviderStatus }) => {
        if (!cancelled && json.ok && json.data) setStatus(json.data);
      })
      .catch(() => { /* keep null */ })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return {
    status,
    provider: status?.activeProvider ?? null,
    loading,
  };
}
