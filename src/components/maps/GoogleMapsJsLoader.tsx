"use client";

import { useJsApiLoader } from "@react-google-maps/api";
import type { ReactNode } from "react";
import { useGoogleMapsApiKey } from "@/lib/hooks/useGoogleMapsApiKey";
import { GOOGLE_MAPS_LOADER_ID, GOOGLE_MAPS_LIBRARIES } from "@/lib/google-maps-constants";

type MapLibraries = typeof GOOGLE_MAPS_LIBRARIES;

export interface GoogleMapsLoaderContext {
  apiKey: string;
  isLoaded: boolean;
  loadError: Error | undefined;
}

interface Props {
  libraries?: MapLibraries;
  loadingFallback?: ReactNode;
  unconfiguredFallback?: ReactNode;
  children: (ctx: GoogleMapsLoaderContext) => ReactNode;
}

/** Wait for API key, then mount Maps JS loader once (avoids empty-key loader init). */
export function GoogleMapsJsLoader({
  libraries = GOOGLE_MAPS_LIBRARIES,
  loadingFallback = null,
  unconfiguredFallback = null,
  children,
}: Props) {
  const { apiKey, loading, configured } = useGoogleMapsApiKey();

  if (loading) return <>{loadingFallback}</>;
  if (!configured || !apiKey) return <>{unconfiguredFallback}</>;

  return (
    <GoogleMapsJsLoaderInner apiKey={apiKey} libraries={libraries}>
      {children}
    </GoogleMapsJsLoaderInner>
  );
}

function GoogleMapsJsLoaderInner({
  apiKey,
  libraries,
  children,
}: {
  apiKey: string;
  libraries: MapLibraries;
  children: (ctx: GoogleMapsLoaderContext) => ReactNode;
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries,
  });

  return <>{children({ apiKey, isLoaded, loadError })}</>;
}
