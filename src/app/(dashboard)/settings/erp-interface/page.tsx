"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FlaskConical, Loader2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ErpInterfaceEnvironmentSettings } from "@/components/settings/ErpInterfaceEnvironmentSettings";
import { isSystemAdminRole } from "@/lib/roles";

export default function ErpInterfaceSettingsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isSystemAdmin = isSystemAdminRole(session?.user?.role);

  useEffect(() => {
    if (status === "authenticated" && !isSystemAdmin) {
      router.replace("/settings");
    }
  }, [status, isSystemAdmin, router]);

  if (status === "loading" || (status === "authenticated" && !isSystemAdmin)) {
    return (
      <PageContainer className="py-12 flex justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0 max-w-5xl">
      <PageHeaderBar
        icon={FlaskConical}
        title="ERP Interface Environment"
        subtitle="ตั้งค่า BC company และ connection ของฝั่ง UAT (Sandbox)"
        backHref="/settings"
        backLabel="Back to Settings"
        right={
          <span
            className="hidden sm:inline text-[10px] font-bold px-2 py-1 rounded-lg shrink-0"
            style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}
          >
            System Admin
          </span>
        }
      />

      <ErpInterfaceEnvironmentSettings />
    </PageContainer>
  );
}
