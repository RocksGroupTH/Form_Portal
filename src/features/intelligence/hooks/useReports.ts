"use client";

import useSWR from "swr";
import type { IntelReport } from "../types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useReports() {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: IntelReport[] }>(
    "/api/intelligence/reports",
    fetcher,
  );
  return { reports: data?.data ?? [], error, isLoading, mutate };
}
