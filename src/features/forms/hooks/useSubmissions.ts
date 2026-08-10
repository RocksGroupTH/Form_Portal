"use client";

import useSWR from "swr";
import type { OfficeFormSubmission } from "../types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Current user's submissions */
export function useMySubmissions(formId?: number, status?: string) {
  const params = new URLSearchParams();
  if (formId) params.set("formId", String(formId));
  if (status) params.set("status", status);
  const qs = params.toString();

  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: OfficeFormSubmission[] }>(
    `/api/forms/submissions${qs ? `?${qs}` : ""}`,
    fetcher,
  );
  return { submissions: data?.data ?? [], error, isLoading, mutate };
}

/** All submissions for admin */
export function useAdminSubmissions(formId?: number, status?: string) {
  const params = new URLSearchParams({ admin: "true" });
  if (formId) params.set("formId", String(formId));
  if (status) params.set("status", status);

  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: OfficeFormSubmission[] }>(
    `/api/forms/submissions?${params.toString()}`,
    fetcher,
  );
  return { submissions: data?.data ?? [], error, isLoading, mutate };
}
