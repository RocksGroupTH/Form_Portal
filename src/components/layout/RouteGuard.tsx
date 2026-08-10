"use client";

import { useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useIsMobile } from "@/lib/hooks/useIsMobile";

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const router = useRouter();

  const blockedByIntel =
    status === "authenticated" &&
    session?.user?.hasIntel === false &&
    (pathname.startsWith("/intelligence") || pathname.startsWith("/locations"));

  useEffect(() => {
    if (blockedByIntel) {
      router.replace("/");
    }
  }, [blockedByIntel, router]);

  if (status === "loading") return null;

  if (status === "unauthenticated") {
    if (isMobile) {
      signIn("microsoft-entra-id", { callbackUrl: "/" });
      return null;
    }
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return null;
  }

  if (blockedByIntel) return null;

  return <>{children}</>;
}
