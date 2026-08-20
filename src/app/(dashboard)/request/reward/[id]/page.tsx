"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Gift } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { RewardDetail } from "@/features/reward/components/RewardDetail";
import { RewardStatusBadge } from "@/features/reward/components/RewardStatusBadge";
import type { RewardRequest } from "@/features/reward/types";

const SUBTITLE = "แบบฟอร์มแลกของรางวัล (AP-11)";

export default function RewardDetailPage() {
  return (
    <Suspense
      fallback={<TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." subtitle={SUBTITLE} />}
    >
      <RewardDetailContent />
    </Suspense>
  );
}

function RewardDetailContent() {
  const params = useParams();
  const rawId = params?.id;
  const requestId = rawId ? Number(String(rawId)) : null;

  const [request, setRequest] = useState<RewardRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchRequest = useCallback(() => {
    if (requestId == null || Number.isNaN(requestId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotFound(false);
    fetch(`/api/request/reward/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: RewardRequest }) => {
        if (json.ok && json.data) setRequest(json.data);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [requestId]);

  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." subtitle={SUBTITLE} />;
  }

  if (notFound || !request) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <PageHeaderBar
          icon={Gift}
          title="ไม่พบคำขอ"
          subtitle="รายการนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง"
          backHref="/my-request"
          backLabel="กลับ"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Gift}
        title={request.requestNo ?? "ฉบับร่าง"}
        subtitle="แลกของรางวัล (สำหรับทีม OP)"
        backHref="/my-request"
        backLabel="กลับ"
        titleExtra={
          <>
            <RewardStatusBadge status={request.status} />
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={{
                background: "var(--bg-badge)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-light)",
              }}
            >
              AP-11
            </span>
          </>
        }
      />
      <RewardDetail request={request} onChanged={fetchRequest} />
    </PageContainer>
  );
}
