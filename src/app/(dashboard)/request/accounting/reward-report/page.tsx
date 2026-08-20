"use client";

import { FileBarChart } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { RewardAdminNav } from "@/features/reward/components/RewardAdminNav";
import { RewardReport } from "@/features/reward/components/RewardReport";
import { useRewardAccess } from "@/features/reward/hooks/useRewardAccess";
import { AP11_FORM_CODE } from "@/features/reward/constants";

export default function RewardReportPage() {
  const { loading, canRewardArea } = useRewardAccess();

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={FileBarChart}
        title="รายงานการเบิกของรางวัล"
        subtitle="AP-11 · คำขอทั้งหมดพร้อมตัวกรอง"
        backHref="/request?group=Settings"
        backLabel="กลับ"
        right={<FormEnvironmentChip formCode={AP11_FORM_CODE} />}
      />

      {loading ? null : canRewardArea ? (
        <>
          <RewardAdminNav className="mb-5" />
          <RewardReport />
        </>
      ) : (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          คุณไม่มีสิทธิ์เข้าถึงหน้านี้ — เฉพาะทีม Assist AP และผู้ดูแลระบบเท่านั้น
        </p>
      )}
    </PageContainer>
  );
}
