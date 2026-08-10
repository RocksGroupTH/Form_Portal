"use client";

import useSWR from "swr";
import type { ApproverInterfaceAccess } from "@/lib/acc/approver-interface-access-shared";

const EMPTY_ACCESS: ApproverInterfaceAccess = {
  allAccess: false,
  allowedCodes: [],
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดสิทธิ์ไม่สำเร็จ");
  }
  return json as { ok: boolean; data: ApproverInterfaceAccess };
};

export function useApproverInterfaceAccess() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/request/accounting/my-interface-access",
    fetcher,
    { revalidateOnFocus: true },
  );

  const ready = !isLoading && !!data?.ok;
  const access = ready && data.data ? data.data : EMPTY_ACCESS;

  return {
    access,
    loading: isLoading,
    ready,
    error,
    mutate,
  };
}
