"use client";

import { FileSpreadsheet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { backTo } from "@/lib/request-hub-nav";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { useBookingAccess } from "@/features/travel-booking/hooks/useBookingAccess";
import { TravelBookingReport } from "@/features/travel-booking/components/TravelBookingReport";

/**
 * AP-17 HR report page (spec §9/§8.3). Gated on `canAccount` from `useBookingAccess`, which is
 * AP-17's own `AccBookingApprover` roster alone — not AP-1's `AccApprover`, and not
 * admin-inclusive.
 *
 * That is deliberately *narrower* than what the backing `report`/`report/export` routes
 * enforce: they authorize with `canAccessBookingArea`, which reads the same roster but keeps
 * an admin arm so an admin can always operate the system. So an admin who is not on the
 * roster is hidden from this page while the routes would still serve them — menu visibility
 * and authorization are separate questions.
 */
export default function TravelBookingReportPage() {
  const searchParams = useSearchParams();
  const { loading: accessLoading, canAccount, error: accessError } = useBookingAccess();

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={FileSpreadsheet}
        title="รายงานการจองที่พัก/ตั๋วโดยสาร (AP-17)"
        titleExtra={<FormEnvironmentChip formCode="AP-17" />}
        subtitle="ค้นหาและส่งออกรายการคำขอจองที่พัก/ตั๋วโดยสารสำหรับฝ่ายบุคคล"
        backHref={backTo("/request/accounting/travel-booking", searchParams.get("from"))}
      />

      {accessLoading ? (
        <div
          className="rounded-2xl py-16 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            กำลังตรวจสอบสิทธิ์...
          </p>
        </div>
      ) : accessError ? (
        /* A permission check that could not be run is not a refusal. Falling
           through to the deny screen would state a reason we do not know —
           the same distinction commit 514c134 drew for the roster panel. */
        <div
          className="rounded-2xl py-16 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[32px] mb-3">⚠️</p>
          <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
            ตรวจสอบสิทธิ์ไม่สำเร็จ
          </h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            ไม่สามารถตรวจสอบสิทธิ์เข้าถึงของคุณได้ในขณะนี้ กรุณาลองโหลดหน้านี้ใหม่อีกครั้ง
          </p>
          <p className="text-[12px] mt-2" style={{ color: "var(--text-faint)" }}>
            {accessError instanceof Error ? accessError.message : "โหลดสิทธิ์ไม่สำเร็จ"}
          </p>
        </div>
      ) : !canAccount ? (
        <div
          className="rounded-2xl py-16 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[32px] mb-3">🔒</p>
          <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
            ไม่มีสิทธิ์เข้าถึง
          </h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            หน้านี้สำหรับผู้ที่อยู่ในรายชื่อสิทธิ์เข้าถึงของ AP-17 เท่านั้น — กรุณาติดต่อผู้ดูแลระบบเพื่อขอเพิ่มรายชื่อ (ผู้ดูแลระบบเพิ่มได้ที่ ตั้งค่า → สิทธิ์เข้าถึง)
          </p>
        </div>
      ) : (
        <TravelBookingReport />
      )}
    </PageContainer>
  );
}
