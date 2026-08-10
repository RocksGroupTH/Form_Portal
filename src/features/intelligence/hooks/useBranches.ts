"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Branch {
  branchId: string;
  branchCode: string;
  branchName: string;
}

export function useBranches(brand = "UNO") {
  const { data } = useSWR<{ ok: boolean; data: Branch[] }>(
    `/api/intelligence/branches?brand=${brand}`,
    fetcher,
  );
  return data?.data ?? [];
}
