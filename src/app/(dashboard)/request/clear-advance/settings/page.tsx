"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Users, Link2, ReceiptText, ListTree } from "lucide-react";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ClrApproverSettings } from "@/features/clear-advance/components/admin/ClrApproverSettings";
import { ClrErpInterfaceSettings } from "@/features/clear-advance/components/admin/ClrErpInterfaceSettings";
import { ClrGlAccountSettings } from "@/features/clear-advance/components/admin/ClrGlAccountSettings";

type TabKey = "erpInterface" | "glAccounts" | "approvers";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "erpInterface", label: "Interface ERP", icon: <Link2 size={15} /> },
  { key: "glAccounts", label: "หมวดบัญชี G/L", icon: <ListTree size={15} /> },
  { key: "approvers", label: "ผู้อนุมัติ", icon: <Users size={15} /> },
];

export default function ClearAdvanceSettingsPage() {
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
      <ClearAdvanceSettingsContent />
    </Suspense>
  );
}

function ClearAdvanceSettingsContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(
    TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "erpInterface",
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
          <Link href="/request/clear-advance" className="inline-block mt-4 text-[12px] px-4 py-2 rounded-lg no-underline font-medium"
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
        icon={ReceiptText}
        title="ตั้งค่าเคลียร์คืนเงินทดรองจ่าย (AP-3)"
        subtitle="Interface ERP (Journal Batch) · หมวดบัญชี G/L · ผู้อนุมัติ"
        backHref={backTo("/request/clear-advance/admin", searchParams.get("from"))}
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
          {activeTab === "erpInterface" && <ClrErpInterfaceSettings />}
          {activeTab === "glAccounts" && <ClrGlAccountSettings />}
          {activeTab === "approvers" && <ClrApproverSettings />}
        </div>
      </div>
    </PageContainer>
  );
}
