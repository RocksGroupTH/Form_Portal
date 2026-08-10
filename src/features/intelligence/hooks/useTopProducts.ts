"use client";

import useSWR from "swr";
import type { TopProductsData } from "../types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useTopProducts(brand = "UNO", period = "mtd", limit = 15) {
  const { data, error, isLoading } = useSWR<{ ok: boolean; data: TopProductsData }>(
    `/api/intelligence/dashboards/top-products?brand=${brand}&period=${period}&limit=${limit}`,
    fetcher,
  );
  return { data: data?.data ?? null, error, isLoading };
}
