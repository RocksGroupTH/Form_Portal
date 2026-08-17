"use client";

import useSWR from "swr";

export type FormEnvironment = "Production" | "UAT";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    throw new Error((json && json.error) || `HTTP ${res.status}`);
  }
  return json as { ok: boolean; data?: Record<string, FormEnvironment> };
};

/**
 * Which database each form writes to, keyed by form code. A form missing from
 * the map is Production.
 *
 * Deliberately silent on failure: this drives a badge. A page that cannot say
 * which environment a form is on should still render the form.
 */
export function useFormEnvironments(): Record<string, FormEnvironment> {
  const { data } = useSWR("/api/form-environment", fetcher);
  return data?.data ?? {};
}
