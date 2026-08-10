"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccountingAccess } from "@/features/accounting/hooks/useAccountingAccess";

export function AccountApproverGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { loading, isApprover } = useAccountingAccess();

  useEffect(() => {
    if (!loading && !isApprover) {
      router.replace("/request/accounting");
    }
  }, [loading, isApprover, router]);

  if (loading) {
    return (
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        กำลังตรวจสอบสิทธิ์...
      </p>
    );
  }

  if (!isApprover) return null;

  return <>{children}</>;
}
