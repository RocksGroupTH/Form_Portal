"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { MyRequestsCard } from "@/features/accounting/components/MyRequestsPanel";
import { ClipboardCheck } from "lucide-react";

export default function MyWorkPage() {
  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={ClipboardCheck}
        title="My Work"
        subtitle="คำขอที่รอคุณอนุมัติหรือเกี่ยวข้อง"
        backHref="/"
      />
      <MyRequestsCard kind="work" header={false} />
    </PageContainer>
  );
}
