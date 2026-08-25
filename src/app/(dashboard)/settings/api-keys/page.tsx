"use client";

import { KeyRound } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ApiKeySettings } from "@/features/settings/ApiKeySettings";

export default function ApiKeysPage() {
  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={KeyRound}
        title="API Keys"
        subtitle="Anthropic · Google Maps · OpenRouteService — พร้อมวันหมดอายุและประวัติการเปลี่ยน"
        backHref="/settings"
      />
      <ApiKeySettings />
    </PageContainer>
  );
}
