"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FlaskConical, Loader2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentSettings } from "@/features/settings/FormEnvironmentSettings";
import { isSystemAdminRole } from "@/lib/roles";

export default function FormEnvironmentPage() {
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
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={FlaskConical}
        title="Form Environment"
        subtitle="กำหนดว่าฟอร์มไหนทำงานบน Production หรือ UAT"
        backHref="/settings"
      />
      <FormEnvironmentSettings />
    </PageContainer>
  );
}
