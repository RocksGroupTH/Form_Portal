import type { WeatherBackdrop, WeatherScene } from "./types";

/** WMO weather interpretation codes (Open-Meteo). */
export function resolveWeatherScene(code: number, isDay: boolean): WeatherScene {
  if (code === 0) return isDay ? "clear-day" : "clear-night";
  if (code === 1 || code === 2) return "partly-cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95) return "storm";
  return isDay ? "partly-cloudy" : "cloudy";
}

const LABELS: Record<WeatherScene, string> = {
  "clear-day": "แดดจัด",
  "clear-night": "ท้องฟ้าแจ่มใส",
  "partly-cloudy": "มีเมฆบางส่วน",
  cloudy: "เมฆมาก",
  fog: "หมอก",
  rain: "ฝนตก",
  storm: "พายุฝนฟ้าคะนอง",
  snow: "หิมะ",
};

const BACKDROPS: Record<WeatherScene, WeatherBackdrop> = {
  "clear-day": {
    scene: "clear-day",
    gradient: "linear-gradient(165deg, #7ec8f0 0%, #b8e4ff 38%, #ffe8b8 72%, transparent 100%)",
    orb: "#ffd86b",
    orbOpacity: 0.55,
    labelTh: LABELS["clear-day"],
  },
  "clear-night": {
    scene: "clear-night",
    gradient: "linear-gradient(165deg, #1a2744 0%, #2d3f6b 45%, #4a5d8a 75%, transparent 100%)",
    orb: "#e8ecf8",
    orbOpacity: 0.2,
    darkSky: true,
    labelTh: LABELS["clear-night"],
  },
  "partly-cloudy": {
    scene: "partly-cloudy",
    gradient: "linear-gradient(165deg, #8ebfe8 0%, #c5dff5 42%, #e8eef5 78%, transparent 100%)",
    orb: "#ffffff",
    orbOpacity: 0.45,
    labelTh: LABELS["partly-cloudy"],
  },
  cloudy: {
    scene: "cloudy",
    gradient: "linear-gradient(165deg, #9aa8b8 0%, #c5ced8 50%, #dde3ea 82%, transparent 100%)",
    orb: "#eef1f5",
    orbOpacity: 0.35,
    labelTh: LABELS.cloudy,
  },
  fog: {
    scene: "fog",
    gradient: "linear-gradient(165deg, #b8c0c8 0%, #d4dae0 55%, #e8ecef 85%, transparent 100%)",
    orb: "#f4f6f8",
    orbOpacity: 0.5,
    labelTh: LABELS.fog,
  },
  rain: {
    scene: "rain",
    gradient: "linear-gradient(165deg, #5a7a96 0%, #7a96ad 45%, #a8bcc9 80%, transparent 100%)",
    orb: "#b8d0e0",
    orbOpacity: 0.25,
    effect: "rain",
    labelTh: LABELS.rain,
  },
  storm: {
    scene: "storm",
    gradient: "linear-gradient(165deg, #3d4a62 0%, #556178 42%, #7a8798 78%, transparent 100%)",
    orb: "#8a9bb0",
    orbOpacity: 0.2,
    darkSky: true,
    effect: "rain",
    labelTh: LABELS.storm,
  },
  snow: {
    scene: "snow",
    gradient: "linear-gradient(165deg, #c8d8e8 0%, #dce8f4 48%, #eef4fa 82%, transparent 100%)",
    orb: "#ffffff",
    orbOpacity: 0.6,
    effect: "snow",
    labelTh: LABELS.snow,
  },
};

export const DEFAULT_BACKDROP: WeatherBackdrop = BACKDROPS["partly-cloudy"];

export function weatherCodeToBackdrop(code: number, isDay: boolean): WeatherBackdrop {
  const scene = resolveWeatherScene(code, isDay);
  return BACKDROPS[scene];
}

export function weatherLabelTh(code: number, isDay: boolean): string {
  return LABELS[resolveWeatherScene(code, isDay)];
}
