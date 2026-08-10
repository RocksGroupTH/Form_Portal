"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { MyRequestsCard } from "@/features/accounting/components/MyRequestsPanel";
import { Send } from "lucide-react";

export default function MyRequestPage() {
  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Send}
        title="My Request"
        subtitle="คำขอที่คุณส่งและสถานะ"
        backHref="/"
      />
      <MyRequestsCard kind="mine" header={false} />
    </PageContainer>
  );
}
