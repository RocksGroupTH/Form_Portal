"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Settings,
  Users,
  Car,
  Building2,
  GitBranch,
  Link2,
  CalendarDays,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ApproverSettings } from "@/features/accounting/components/settings/ApproverSettings";
import { SameDayBrandSettings } from "@/features/accounting/components/settings/SameDayBrandSettings";
import { VehicleSettings } from "@/features/accounting/components/settings/VehicleSettings";
import { BrandSettings } from "@/features/accounting/components/settings/BrandSettings";
import { DepartmentMappingSettings } from "@/features/accounting/components/settings/DepartmentMappingSettings";
import { BrandErpInterfaceSettings } from "@/features/accounting/components/settings/BrandErpInterfaceSettings";

type TabKey =
  | "sameDayBrand"
  | "approvers"
  | "vehicles"
  | "brands"
  | "departments"
  | "erpInterface";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "sameDayBrand", label: "เบิกวันซ้ำข้ามแบรนด์", icon: <CalendarDays size={15} /> },
  { key: "approvers", label: "ผู้อนุมัติบัญชี", icon: <Users size={15} /> },
  { key: "vehicles", label: "พาหนะ & เรท", icon: <Car size={15} /> },
  { key: "brands", label: "แบรนด์ที่เบิกได้", icon: <Building2 size={15} /> },
  { key: "erpInterface", label: "Interface ERP", icon: <Link2 size={15} /> },
  { key: "departments", label: "แผนก (HR ↔ ERP)", icon: <GitBranch size={15} /> },
];

function parseTabKey(raw: string | null): TabKey {
  if (raw && TABS.some((t) => t.key === raw)) return raw as TabKey;
  return "approvers";
}

export default function AccountingSettingsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer className="acc-theme py-6 px-3 sm:px-0">
          <div className="flex items-center justify-center py-20">
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              กำลังโหลด...
            </p>
          </div>
        </PageContainer>
      }
    >
      <AccountingSettingsContent />
    </Suspense>
  );
}

function AccountingSettingsContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(() => parseTabKey(tabParam));

  useEffect(() => {
    setActiveTab(parseTabKey(tabParam));
  }, [tabParam]);

  if (status === "loading") {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <div className="flex items-center justify-center py-20">
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            กำลังโหลด...
          </p>
        </div>
      </PageContainer>
    );
  }

  const role = session?.user?.role;
  if (role !== "IT Admin" && role !== "System Admin") {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <div
          className="rounded-2xl py-16 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[32px] mb-3">🔒</p>
          <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
            ไม่มีสิทธิ์เข้าถึง
          </h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            หน้านี้สำหรับ IT Admin และ System Admin เท่านั้น
          </p>
          <Link
            href="/request/accounting"
            className="inline-block mt-4 text-[12px] px-4 py-2 rounded-lg no-underline font-medium"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings}
        title="ตั้งค่าเบิกค่าเดินทาง"
        subtitle="จัดการผู้อนุมัติบัญชี พาหนะ แบรนด์ และ Interface ERP"
        backHref="/request/accounting"
      />

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div
          className="flex gap-1 px-4 pt-4 pb-0 overflow-x-auto no-scrollbar"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
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
          {activeTab === "sameDayBrand" && <SameDayBrandSettings />}
          {activeTab === "approvers" && <ApproverSettings />}
          {activeTab === "vehicles" && <VehicleSettings />}
          {activeTab === "brands" && <BrandSettings />}
          {activeTab === "erpInterface" && <BrandErpInterfaceSettings />}
          {activeTab === "departments" && <DepartmentMappingSettings />}
        </div>
      </div>
    </PageContainer>
  );
}
