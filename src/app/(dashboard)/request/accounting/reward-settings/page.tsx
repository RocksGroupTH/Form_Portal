"use client";

import { Settings2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { RewardAdminNav } from "@/features/reward/components/RewardAdminNav";
import { RewardSettings } from "@/features/reward/components/RewardSettings";
import { RewardOfficerSettings } from "@/features/reward/components/RewardOfficerSettings";
import { RewardBrandSettings } from "@/features/reward/components/RewardBrandSettings";
import { useRewardAccess } from "@/features/reward/hooks/useRewardAccess";
import { useRole } from "@/lib/hooks/useRole";
import { AP11_FORM_CODE } from "@/features/reward/constants";

/**
 * AP-11 configuration: the reward catalogue, and who the Assist AP team are.
 *
 * The two have different gates on the server — an officer manages the
 * catalogue, but only an admin edits the roster that decides who the officers
 * are — so the roster panel only renders for an admin rather than rendering and
 * then failing every write with a 403.
 */
export default function RewardSettingsPage() {
  const { loading, canRewardArea } = useRewardAccess();
  const { canAdmin } = useRole();

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings2}
        title="ตั้งค่าของรางวัล"
        subtitle="AP-11 · คลังของรางวัล และทีม Assist AP"
        backHref="/request?group=Settings"
        backLabel="กลับ"
        right={<FormEnvironmentChip formCode={AP11_FORM_CODE} />}
      />

      {loading ? null : !canRewardArea ? (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          คุณไม่มีสิทธิ์เข้าถึงหน้านี้ — เฉพาะทีม Assist AP และผู้ดูแลระบบเท่านั้น
        </p>
      ) : (
        <div className="space-y-5">
          <RewardAdminNav />
          <RewardSettings />
          {canAdmin && <RewardBrandSettings />}
          {canAdmin && <RewardOfficerSettings />}
        </div>
      )}
    </PageContainer>
  );
}
