"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Users, Landmark, Wallet, SlidersHorizontal, Link2 } from "lucide-react";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { AdvanceApproverSettings } from "@/features/advance/components/settings/AdvanceApproverSettings";
import { AdvanceApprovalMatrixSettings } from "@/features/advance/components/settings/AdvanceApprovalMatrixSettings";
import { AdvanceBankMasterSettings } from "@/features/advance/components/settings/AdvanceBankMasterSettings";
import { AdvanceErpInterfaceSettings } from "@/features/advance/components/settings/AdvanceErpInterfaceSettings";

type TabKey = "approvers" | "matrix" | "banks" | "erpInterface";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "approvers", label: "ผู้อนุมัติ", icon: <Users size={15} /> },
  { key: "matrix", label: "ขั้นตามเงิน", icon: <SlidersHorizontal size={15} /> },
  { key: "banks", label: "ธนาคาร (Master)", icon: <Landmark size={15} /> },
  { key: "erpInterface", label: "Interface ERP", icon: <Link2 size={15} /> },
];

export default function AdvanceSettingsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer className="acc-theme py-6 px-3 sm:px-0">
          <div className="flex items-center justify-center py-20">
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
          </div>
        </PageContainer>
      }
    >
      <AdvanceSettingsContent />
    </Suspense>
  );
}

function AdvanceSettingsContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(
    TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "approvers",
  );

  if (status === "loading") {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <div className="flex items-center justify-center py-20">
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
        </div>
      </PageContainer>
    );
  }

  const role = session?.user?.role;
  if (role !== "IT Admin" && role !== "System Admin") {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <div className="rounded-2xl py-16 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <p className="text-[32px] mb-3">🔒</p>
          <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>ไม่มีสิทธิ์เข้าถึง</h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>หน้านี้สำหรับ IT Admin และ System Admin เท่านั้น</p>
          <Link href="/request/advance" className="inline-block mt-4 text-[12px] px-4 py-2 rounded-lg no-underline font-medium"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
            กลับหน้าฟอร์ม
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Wallet}
        title="ตั้งค่าเบิกเงินทดรองจ่าย (AP-2)"
        subtitle="ผู้อนุมัติ · ขั้นตามเงิน · ธนาคาร · Interface ERP"
        backHref={backTo("/request/advance/admin", searchParams.get("from"))}
      />

      <div className="rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div className="flex gap-1 px-4 pt-4 pb-0 overflow-x-auto no-scrollbar"
          style={{ borderBottom: "1px solid var(--border-card)" }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold cursor-pointer border-none rounded-t-lg transition-colors shrink-0 whitespace-nowrap"
                style={{
                  background: active ? "var(--bg-card)" : "transparent",
                  color: active ? "var(--nav-active-text)" : "var(--text-muted)",
                  borderBottom: active ? "2px solid var(--nav-active-text)" : "2px solid transparent",
                  marginBottom: "-1px",
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="p-5">
          {activeTab === "approvers" && <AdvanceApproverSettings />}
          {activeTab === "matrix" && <AdvanceApprovalMatrixSettings />}
          {activeTab === "banks" && <AdvanceBankMasterSettings />}
          {activeTab === "erpInterface" && <AdvanceErpInterfaceSettings />}
        </div>
      </div>
    </PageContainer>
  );
}
