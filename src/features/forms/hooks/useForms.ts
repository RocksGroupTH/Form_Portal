"use client";

import useSWR from "swr";
import type { OfficeForm } from "../types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Published forms for the catalog */
export function useForms() {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: OfficeForm[] }>(
    "/api/forms",
    fetcher,
  );
  return { forms: data?.data ?? [], error, isLoading, mutate };
}

/** All forms for admin (includes Draft/Archived) */
export function useAdminForms() {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: (OfficeForm & { submissionCount: number })[] }>(
    "/api/forms?admin=true",
    fetcher,
  );
  return { forms: data?.data ?? [], error, isLoading, mutate };
}
