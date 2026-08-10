"use client";

import { useCallback, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { useErpSandboxDevHost } from "@/features/accounting/hooks/useErpSandboxDevHost";
import type { ErpBcEnvironment, ErpEnvironmentInfo } from "@/lib/acc/erp-environment-shared";
import { erpEnvironmentLabel } from "@/lib/acc/erp-environment-shared";

const ENV_API = "/api/request/accounting/erp-environment";
const SETTINGS_API = "/api/settings/erp-interface";

const DEFAULT: ErpEnvironmentInfo = {
  effectiveEnvironment: "Production",
  globalEnvironment: "Production",
  canUseSandbox: false,
  canConfigure: false,
  sandboxHostAllowed: false,
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
  const devHost = useErpSandboxDevHost();
  const [toggling, setToggling] = useState(false);
  const shouldFetch = status === "authenticated" && devHost;
  const { data, error, isLoading, mutate } = useSWR(
    shouldFetch ? ENV_API : null,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 60_000 },
  );

  const ready = !isLoading && !!data?.ok;
  const env = ready && data.data ? data.data : DEFAULT;

  const setEnvironment = useCallback(
    async (next: ErpBcEnvironment) => {
      if (!env.canConfigure) return false;
      setToggling(true);
      try {
        const res = await fetch(SETTINGS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ environment: next }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(typeof json.error === "string" ? json.error : "สลับสภาพแวดล้อมไม่สำเร็จ");
        }
        await mutate();
        await globalMutate(ENV_API);
        await globalMutate(SETTINGS_API);
        toast.success(`เปลี่ยนเป็น ${erpEnvironmentLabel(next)} แล้ว`);
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "สลับสภาพแวดล้อมไม่สำเร็จ");
        return false;
      } finally {
        setToggling(false);
      }
    },
    [env.canConfigure, mutate],
  );

  const toggleEnvironment = useCallback(async () => {
    const next: ErpBcEnvironment =
      env.effectiveEnvironment === "Sandbox" ? "Production" : "Sandbox";
    return setEnvironment(next);
  }, [env.effectiveEnvironment, setEnvironment]);

  return {
    env,
    loading: isLoading,
    ready,
    toggling,
    error,
    mutate,
    setEnvironment,
    toggleEnvironment,
    isSandbox: env.effectiveEnvironment === "Sandbox",
  };
}
