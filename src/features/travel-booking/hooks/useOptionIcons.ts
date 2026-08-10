"use client";

import { useMemo } from "react";
import useSWR from "swr";

/** Emoji per option id, keyed by the option list it came from. */
export interface OptionIconMaps {
  reason: Record<number, string | null>;
  accommodation: Record<number, string | null>;
  vehicle: Record<number, string | null>;
  rent: Record<number, string | null>;
}

const EMPTY: OptionIconMaps = { reason: {}, accommodation: {}, vehicle: {}, rent: {} };

const SETTINGS_URL = "/api/request/travel-booking/options/settings";

type OptionRow = { id: number; icon: string | null };

interface SettingsPayload {
  reasons?: OptionRow[];
  accommodations?: OptionRow[];
  vehicles?: OptionRow[];
  rentVehicles?: OptionRow[];
}

/**
 * Matches `useTravelBookingForm`'s `jsonFetcher` exactly — unwraps the `{ ok, data }` envelope
 * and throws on failure. SWR caches per key regardless of which fetcher ran, so both hooks
 * MUST resolve this key to the same shape; caching icon maps here instead would hand the form
 * a payload with no `reasons` (and hand this hook a payload with no `reason`, which crashed
 * the detail view on `icons.reason[...]`).
 */
async function fetchSettings(url: string): Promise<SettingsPayload> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Request failed");
  return (json.data ?? {}) as SettingsPayload;
}

function toMap(rows: OptionRow[] | undefined): Record<number, string | null> {
  const out: Record<number, string | null> = {};
  for (const r of rows ?? []) out[r.id] = r.icon ?? null;
  return out;
}

/**
 * Option emojis (เหตุผล / ที่พัก / ยานพาหนะ / รถเช่า) live in settings, not on the request —
 * views that want to echo the requester's choice have to resolve them by id. Shares the
 * settings request with the form hook, so opening a detail costs no extra round trip.
 */
export function useTravelBookingOptionIcons(): OptionIconMaps {
  const { data } = useSWR<SettingsPayload>(SETTINGS_URL, fetchSettings, {
    revalidateOnFocus: false,
  });
  return useMemo(
    () =>
      data
        ? {
            reason: toMap(data.reasons),
            accommodation: toMap(data.accommodations),
            vehicle: toMap(data.vehicles),
            rent: toMap(data.rentVehicles),
          }
        : EMPTY,
    [data],
  );
}
