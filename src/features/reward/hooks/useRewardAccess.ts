"use client";

import useSWR from "swr";

interface RewardAccessData {
  /** Active row in `AccRewardOfficer`. */
  officer: boolean;
  /** Officer or IT/System Admin — the queue, the report and the catalogue. */
  rewardArea: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดสิทธิ์ไม่สำเร็จ");
  }
  return json as { ok: boolean; data: RewardAccessData };
};

/**
 * Whether this viewer sees the AP-11 back office.
 *
 * The server decides; this only drives what renders. Every route re-checks —
 * hiding a button is presentation, not authorization.
 */
export function useRewardAccess() {
  const { data, error, isLoading } = useSWR("/api/request/reward/access", fetcher);
  const access = data?.data;
  return {
    loading: isLoading,
    error,
    isOfficer: access?.officer ?? false,
    canRewardArea: access?.rewardArea ?? false,
  };
}
