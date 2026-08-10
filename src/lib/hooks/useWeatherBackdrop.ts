"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { DEFAULT_BACKDROP, weatherCodeToBackdrop } from "@/lib/weather/background";
import type { WeatherBackdrop } from "@/lib/weather/types";

const BANGKOK = { lat: 13.7563, lon: 100.5018 };
const COORDS_KEY = "rocks-fast-weather-coords";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface WeatherApiData {
  weatherCode: number;
  isDay: boolean;
  temperature: number;
  labelTh: string;
}

export function useWeatherBackdrop(enabled: boolean): {
  backdrop: WeatherBackdrop;
  temperature: number | null;
  labelTh: string | null;
  loading: boolean;
} {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    try {
      const cached = sessionStorage.getItem(COORDS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { lat: number; lon: number };
        if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lon)) {
          setCoords(parsed);
          return;
        }
      }
    } catch {
      /* ignore */
    }

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          try {
            sessionStorage.setItem(COORDS_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          setCoords(next);
        },
        () => setCoords(BANGKOK),
        { timeout: 6000, maximumAge: 3_600_000 },
      );
    } else {
      setCoords(BANGKOK);
    }
  }, [enabled]);

  const query =
    enabled && coords != null
      ? `/api/weather/current?lat=${coords.lat.toFixed(2)}&lon=${coords.lon.toFixed(2)}`
      : null;

  const { data, isLoading } = useSWR<{ ok: boolean; data?: WeatherApiData }>(query, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30 * 60_000,
  });

  const weather = data?.data;
  const backdrop =
    weather != null
      ? weatherCodeToBackdrop(weather.weatherCode, weather.isDay)
      : DEFAULT_BACKDROP;

  return {
    backdrop,
    temperature: weather?.temperature ?? null,
    labelTh: weather?.labelTh ?? null,
    loading: enabled && coords != null && isLoading && weather == null,
  };
}
