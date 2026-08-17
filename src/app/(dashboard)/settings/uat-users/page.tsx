"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FlaskConical, Loader2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { UatUserSettings } from "@/features/settings/UatUserSettings";
import { isSystemAdminRole } from "@/lib/roles";

export default function UatUsersPage() {
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
        title="UAT Users"
        subtitle="รายชื่อผู้ทดสอบ และผู้จัดการสำหรับ UAT ของแต่ละคน"
        backHref="/settings"
      />
      <UatUserSettings />
    </PageContainer>
  );
}
