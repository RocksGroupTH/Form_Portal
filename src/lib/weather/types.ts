export type WeatherScene =
  | "clear-day"
  | "clear-night"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "rain"
  | "storm"
  | "snow";

export interface WeatherBackdrop {
  scene: WeatherScene;
  gradient: string;
  orb?: string;
  orbOpacity?: number;
  effect?: "rain" | "snow";
  darkSky?: boolean;
  labelTh: string;
}

export interface CurrentWeather {
  weatherCode: number;
  isDay: boolean;
  temperature: number;
  labelTh: string;
  scene: WeatherScene;
}
