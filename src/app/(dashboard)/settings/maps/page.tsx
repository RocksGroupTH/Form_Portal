"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Map, Loader2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { MapProviderSettings } from "@/components/settings/MapProviderSettings";

export default function MapsSettingsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isAdmin =
    session?.user?.role === "IT Admin" || session?.user?.role === "System Admin";

  useEffect(() => {
    if (status === "authenticated" && !isAdmin) router.replace("/");
  }, [status, isAdmin, router]);

  if (status === "loading" || (status === "authenticated" && !isAdmin)) {
    return (
      <PageContainer className="py-12 flex justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Map}
        title="Maps & Routing"
        subtitle="Google Maps API Key"
        backHref="/settings"
      />

      <MapProviderSettings />
    </PageContainer>
  );
}
