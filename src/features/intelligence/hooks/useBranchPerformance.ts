"use client";

import useSWR from "swr";
import type { BranchData } from "../types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useBranchPerformance(brand = "UNO", period = "mtd") {
  const { data, error, isLoading } = useSWR<{ ok: boolean; data: BranchData }>(
    `/api/intelligence/dashboards/branch-performance?brand=${brand}&period=${period}`,
    fetcher,
  );
  return { data: data?.data ?? null, error, isLoading };
}
