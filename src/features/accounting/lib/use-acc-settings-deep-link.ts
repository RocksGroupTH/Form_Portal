"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { scrollToErpSettingsFocus } from "@/features/accounting/lib/erp-prep-issue-links";

interface AccSettingsDeepLinkOptions {
  ready: boolean;
  onOpenInterfaceGroup?: (iface: string) => void;
  onOpenUnassignedClaim?: (claim: string) => void;
  onOpenDepartmentGroup?: (iface: string) => void;
}

/** Applies ?iface= & ?claim= & ?focus= from settings URL once data is loaded. */
export function useAccSettingsDeepLink({
  ready,
  onOpenInterfaceGroup,
  onOpenUnassignedClaim,
  onOpenDepartmentGroup,
}: AccSettingsDeepLinkOptions): void {
  const searchParams = useSearchParams();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!ready || handledRef.current) return;

    const iface = searchParams.get("iface")?.trim().toUpperCase() || "";
    const claim = searchParams.get("claim")?.trim().toUpperCase() || "";
    const focus = searchParams.get("focus")?.trim() || "";

    if (onOpenDepartmentGroup && iface) {
      onOpenDepartmentGroup(iface);
    } else if (onOpenInterfaceGroup && iface) {
      onOpenInterfaceGroup(iface);
    } else if (onOpenUnassignedClaim && claim) {
      onOpenUnassignedClaim(claim);
    }

    if (focus) {
      scrollToErpSettingsFocus(focus, claim || null);
    }

    if (iface || claim || focus) {
      handledRef.current = true;
    }
  }, [
    ready,
    searchParams,
    onOpenInterfaceGroup,
    onOpenUnassignedClaim,
    onOpenDepartmentGroup,
  ]);
}
