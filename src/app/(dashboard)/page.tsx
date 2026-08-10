"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { HomeCatalogue } from "@/features/home/HomeCatalogue";

export default function DashboardPage() {
  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <HomeCatalogue />
    </PageContainer>
  );
}
