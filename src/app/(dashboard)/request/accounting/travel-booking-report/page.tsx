"use client";

import { FileSpreadsheet } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { useAccountingAccess } from "@/features/accounting/hooks/useAccountingAccess";
import { TravelBookingReport } from "@/features/travel-booking/components/TravelBookingReport";

/**
 * AP-17 HR report page (spec §9/§8.3). Gated on `canAccount` (approver OR IT/System Admin) —
 * the same gate the backing `report`/`report/export` routes enforce via `canAccessAccountArea`
 * — rather than `AccountApproverGuard` (AP-1's guard, which only checks `isApprover` and would
 * incorrectly hide this page from IT/System Admin viewers who aren't rows in `AccApprover`).
 */
export default function TravelBookingReportPage() {
  const { loading: accessLoading, canAccount } = useAccountingAccess();

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={FileSpreadsheet}
        title="รายงานการจองที่พัก/ตั๋วโดยสาร (AP-17)"
        subtitle="ค้นหาและส่งออกรายการคำขอจองที่พัก/ตั๋วโดยสารสำหรับฝ่ายบุคคล"
        backHref="/request/accounting/travel-booking"
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
            หน้านี้สำหรับผู้อนุมัติฝ่ายบัญชี / IT Admin / System Admin เท่านั้น
          </p>
        </div>
      ) : (
        <TravelBookingReport />
      )}
    </PageContainer>
  );
}
