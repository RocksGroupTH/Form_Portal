import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveWeatherScene, weatherLabelTh } from "@/lib/weather/background";

const BANGKOK_LAT = 13.7563;
const BANGKOK_LON = 100.5018;

interface OpenMeteoCurrent {
  temperature_2m: number;
  weather_code: number;
  is_day: number;
}

export async function GET(req: Request) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { searchParams } = new URL(req.url);
  const lat = clampCoord(searchParams.get("lat"), BANGKOK_LAT);
  const lon = clampCoord(searchParams.get("lon"), BANGKOK_LON);

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&current=temperature_2m,weather_code,is_day&timezone=auto";

    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "Weather service unavailable" }, { status: 502 });
    }

    const json = await res.json() as { current?: OpenMeteoCurrent };
    const current = json.current;
    if (!current) {
      return NextResponse.json({ ok: false, error: "No weather data" }, { status: 502 });
    }

    const isDay = current.is_day === 1;
    const weatherCode = current.weather_code;

    return NextResponse.json({
      ok: true,
      data: {
        weatherCode,
        isDay,
        temperature: Math.round(current.temperature_2m),
        scene: resolveWeatherScene(weatherCode, isDay),
        labelTh: weatherLabelTh(weatherCode, isDay),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to fetch weather" }, { status: 500 });
  }
}

function clampCoord(raw: string | null, fallback: number): number {
  const n = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}
