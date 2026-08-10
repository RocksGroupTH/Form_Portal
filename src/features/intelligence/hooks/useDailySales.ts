"use client";

import useSWR from "swr";
import type { DailySalesData } from "../types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useDailySales(brand = "UNO", days = 30) {
  const { data, error, isLoading } = useSWR<{ ok: boolean; data: DailySalesData }>(
    `/api/intelligence/dashboards/daily-sales?brand=${brand}&days=${days}`,
    fetcher,
  );
  return { data: data?.data ?? null, error, isLoading };
}
