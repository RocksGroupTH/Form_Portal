"use client";

import useSWR from "swr";

interface AccountingAccessData {
  account: boolean;
  approver: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "โหลดสิทธิ์ไม่สำเร็จ");
  }
  return json as { ok: boolean; data: AccountingAccessData };
};

export function useAccountingAccess() {
  const { data, error, isLoading } = useSWR("/api/request/accounting/access", fetcher);

  const access = data?.data;
  return {
    loading: isLoading,
    error,
    /** Active row in AccApprover */
    isApprover: access?.approver ?? false,
    /** Approver or IT/System Admin — report & account APIs */
    canAccount: access?.account ?? false,
  };
}
