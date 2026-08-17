"use client";

import useSWR from "swr";
import { useSession } from "next-auth/react";
import type { ErpEnvironmentInfo } from "@/lib/acc/erp-environment-shared";

const ENV_API = "/api/request/accounting/erp-environment";

const DEFAULT: ErpEnvironmentInfo = {
  effectiveEnvironment: "Production",
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดสภาพแวดล้อม ERP ไม่สำเร็จ");
  }
  return json as { ok: boolean; data: ErpEnvironmentInfo };
};

export function useErpInterfaceEnvironment() {
  const { status } = useSession();
  const shouldFetch = status === "authenticated";
  const { data, error, isLoading, mutate } = useSWR(
    shouldFetch ? ENV_API : null,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 60_000 },
  );

  const ready = !isLoading && !!data?.ok;
  const env = ready && data.data ? data.data : DEFAULT;

  return {
    env,
    loading: isLoading,
    ready,
    error,
    mutate,
    isSandbox: env.effectiveEnvironment === "Sandbox",
  };
}
