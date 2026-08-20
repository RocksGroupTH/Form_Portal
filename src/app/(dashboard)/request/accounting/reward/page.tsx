"use client";

import { PackageCheck } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { RewardAdminNav } from "@/features/reward/components/RewardAdminNav";
import { RewardQueue } from "@/features/reward/components/RewardQueue";
import { useRewardAccess } from "@/features/reward/hooks/useRewardAccess";
import { AP11_FORM_CODE } from "@/features/reward/constants";

/**
 * The Assist AP work page (brief §"หน้าทำงานของ Assist AP").
 *
 * `useRewardAccess` decides what renders; every API this page calls re-checks
 * on the server. Hiding the queue is presentation, not a control.
 */
export default function RewardQueuePage() {
  const { loading, canRewardArea } = useRewardAccess();

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={PackageCheck}
        title="คิวจัดของรางวัล"
        subtitle="AP-11 · อนุมัติ → จัดของ → จ่ายของ"
        backHref="/request?group=Settings"
        backLabel="กลับ"
        right={<FormEnvironmentChip formCode={AP11_FORM_CODE} />}
      />

      {loading ? null : canRewardArea ? (
        <>
          <RewardAdminNav className="mb-5" />
          <RewardQueue />
        </>
      ) : (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          คุณไม่มีสิทธิ์เข้าถึงหน้านี้ — เฉพาะทีม Assist AP และผู้ดูแลระบบเท่านั้น
        </p>
      )}
    </PageContainer>
  );
}
