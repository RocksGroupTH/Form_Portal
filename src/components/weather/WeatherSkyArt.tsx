"use client";

import React from "react";
import type { WeatherScene } from "@/lib/weather/types";

function SunIcon({ size = 56, className = "" }: { size?: number; className?: string }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`profile-weather-sun ${className}`}
      aria-hidden
    >
      <defs>
        <radialGradient id="profileSunCore" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fff4c2" />
          <stop offset="55%" stopColor="#ffd54a" />
          <stop offset="100%" stopColor="#f5a623" />
        </radialGradient>
      </defs>
      {rays.map((deg) => (
        <line
          key={deg}
          x1="32"
          y1="32"
          x2="32"
          y2="7"
          stroke="#ffd54a"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.85"
          transform={`rotate(${deg} 32 32)`}
        />
      ))}
      <circle cx="32" cy="32" r="15" fill="url(#profileSunCore)" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="rgba(255,220,100,0.5)" strokeWidth="1" />
    </svg>
  );
}

function MoonIcon({ size = 44, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden
    >
      <defs>
        <radialGradient id="profileMoonGlow" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#f8f4e8" />
          <stop offset="100%" stopColor="#c8d0e8" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="14" fill="url(#profileMoonGlow)" />
      <circle cx="31" cy="18" r="12" fill="#2d3f6b" />
    </svg>
  );
}

function CloudIcon({
  width = 88,
  fill = "#ffffff",
  opacity = 0.92,
  className = "",
}: {
  width?: number;
  fill?: string;
  opacity?: number;
  className?: string;
}) {
  const height = Math.round(width * 0.42);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 50"
      className={className}
      style={{ opacity }}
      aria-hidden
    >
      <path
        d="M22 36 C14 36 10 28 16 22 C12 14 22 8 32 12 C38 4 54 6 58 16 C72 12 86 22 82 34 C90 36 92 44 82 44 L28 44 C20 44 18 38 22 36 Z"
        fill={fill}
      />
    </svg>
  );
}

function Stars({ className = "" }: { className?: string }) {
  const dots = [
    { x: 8, y: 10, r: 1.2 },
    { x: 18, y: 6, r: 0.9 },
    { x: 28, y: 14, r: 1.1 },
    { x: 38, y: 8, r: 0.8 },
    { x: 48, y: 12, r: 1 },
    { x: 22, y: 18, r: 0.7 },
  ];
  return (
    <svg className={`absolute inset-0 w-full h-full ${className}`} aria-hidden>
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={`${d.x}%`}
          cy={`${d.y}%`}
          r={d.r}
          fill="rgba(255,255,255,0.85)"
          className="profile-weather-star"
          style={{ animationDelay: `${i * 0.55}s` }}
        />
      ))}
    </svg>
  );
}

export function WeatherSkyArt({
  scene,
  className = "absolute inset-0",
}: {
  scene: WeatherScene;
  className?: string;
}) {
  const wrap = `${className} pointer-events-none overflow-hidden`;

  switch (scene) {
    case "clear-day":
      return (
        <div className={wrap} aria-hidden>
          <div className="absolute -top-1 left-2 profile-weather-drift-sun">
            <SunIcon size={62} />
          </div>
        </div>
      );

    case "clear-night":
      return (
        <div className={wrap} aria-hidden>
          <Stars className="profile-weather-cloud-c" />
          <div className="absolute top-2 left-4 profile-weather-drift-moon">
            <MoonIcon size={46} />
          </div>
        </div>
      );

    case "partly-cloudy":
      return (
        <div className={wrap} aria-hidden>
          <div className="absolute top-0 left-1 profile-weather-drift-sun z-0">
            <SunIcon size={48} />
          </div>
          <div className="absolute top-5 left-6 profile-weather-cloud-a z-[2]">
            <CloudIcon width={96} opacity={0.95} />
          </div>
          <div className="absolute top-9 left-20 profile-weather-cloud-b z-[1] opacity-75">
            <CloudIcon width={64} opacity={0.82} />
          </div>
        </div>
      );

    case "cloudy":
      return (
        <div className={wrap} aria-hidden>
          <div className="absolute -top-1 left-0 profile-weather-cloud-a">
            <CloudIcon width={104} fill="#f0f4f8" opacity={0.95} />
          </div>
          <div className="absolute top-7 left-10 profile-weather-cloud-b">
            <CloudIcon width={72} fill="#e8edf2" opacity={0.85} />
          </div>
          <div className="absolute top-2 left-24 profile-weather-cloud-c opacity-65">
            <CloudIcon width={56} fill="#eef2f6" opacity={0.75} />
          </div>
        </div>
      );

    case "fog":
      return (
        <div className={wrap} aria-hidden>
          <div className="absolute top-2 -left-3 profile-weather-fog-a opacity-50">
            <CloudIcon width={118} fill="#f4f6f8" opacity={0.7} />
          </div>
          <div className="absolute top-8 left-12 profile-weather-fog-b opacity-40">
            <CloudIcon width={86} fill="#eef1f4" opacity={0.6} />
          </div>
        </div>
      );

    case "rain":
      return (
        <div className={wrap} aria-hidden>
          <div className="absolute -top-2 -left-2 profile-weather-cloud-a">
            <CloudIcon width={112} fill="#d8e4ee" opacity={0.92} />
          </div>
          <div className="absolute top-5 left-8 profile-weather-cloud-b">
            <CloudIcon width={80} fill="#c8d6e2" opacity={0.82} />
          </div>
          <div className="absolute top-10 left-20 profile-weather-cloud-c opacity-70">
            <CloudIcon width={58} fill="#d0dde8" opacity={0.75} />
          </div>
        </div>
      );

    case "storm":
      return (
        <div className={wrap} aria-hidden>
          <div className="absolute -top-3 -left-2 profile-weather-cloud-a">
            <CloudIcon width={116} fill="#8a9bb0" opacity={0.95} />
          </div>
          <div className="absolute top-4 left-6 profile-weather-cloud-b">
            <CloudIcon width={88} fill="#7a8da3" opacity={0.88} />
          </div>
          <div className="absolute top-9 left-20 profile-weather-cloud-c opacity-75">
            <CloudIcon width={62} fill="#8496ab" opacity={0.8} />
          </div>
        </div>
      );

    case "snow":
      return (
        <div className={wrap} aria-hidden>
          <div className="absolute -top-1 left-0 profile-weather-cloud-a">
            <CloudIcon width={104} fill="#f0f6fc" opacity={0.95} />
          </div>
          <div className="absolute top-6 left-10 profile-weather-cloud-b">
            <CloudIcon width={74} fill="#e8f0f8" opacity={0.85} />
          </div>
          <div className="absolute top-2 left-24 profile-weather-cloud-c opacity-65">
            <CloudIcon width={52} fill="#f4f8fc" opacity={0.78} />
          </div>
        </div>
      );

    default:
      return null;
  }
}
