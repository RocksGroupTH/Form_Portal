"use client";

import useSWR from "swr";
import { useSession } from "next-auth/react";
import { resolveUserDisplayPhoto } from "@/lib/hr/photo-url";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Best available profile photo: session (TeamMember / AD) then HR Employee.
 */
export function useUserPhoto(): string | null {
  const { data: session, status } = useSession();
  const user = session?.user;

  const { data: empRes } = useSWR<{ ok: boolean; data?: { employee?: { photoUrl?: string | null } | null } }>(
    status === "authenticated" && user?.email ? "/api/me/employee" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000 },
  );

  return resolveUserDisplayPhoto(user?.photo, empRes?.data?.employee?.photoUrl);
}
