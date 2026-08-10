"use client";

import { useSession, signIn } from "next-auth/react";
import { useIsMobile } from "@/lib/hooks/useIsMobile";

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isMobile = useIsMobile();

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

  return <>{children}</>;
}
