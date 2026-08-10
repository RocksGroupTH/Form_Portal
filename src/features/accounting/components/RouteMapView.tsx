"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { RouteWaypoint } from "@/features/accounting/types";

const GoogleRouteView = dynamic(() => import("./GoogleRouteView"), { ssr: false });

interface Point {
  lat: number;
  lng: number;
}

interface Props {
  origin: Point;
  dest: Point;
  waypoints?: RouteWaypoint[] | null;
  height?: number;
}

/** Read-only route map — Google Maps. */
export default function RouteMapView({ origin, dest, waypoints, height }: Props) {
  return <GoogleRouteView origin={origin} dest={dest} waypoints={waypoints} height={height} />;
}
