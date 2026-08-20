"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Settings,
  Car,
  Building2,
  GitBranch,
  Link2,
  CalendarDays,
  ShieldCheck,
} from "lucide-react";
import { backTo } from "@/lib/request-hub-nav";
import { isGrantableSettingsTabKey } from "@/lib/acc/settings-tabs";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { useAccountingAccess } from "@/features/accounting/hooks/useAccountingAccess";
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

/**
 * ACC Portal's order and labels — that app shares this physical database, so
 * the two settings screens must read alike. The keys are unchanged, so
 * bookmarked `?tab=` links still resolve; only labels, icons and order moved.
 */
const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "brands", label: "แบรนด์ที่เบิก", icon: <Building2 size={15} /> },
  { key: "sameDayBrand", label: "เบิกวันซ้ำข้ามแบรนด์", icon: <CalendarDays size={15} /> },
  { key: "vehicles", label: "พาหนะ & เรท", icon: <Car size={15} /> },
  { key: "departments", label: "แผนก (HR ↔ ERP)", icon: <GitBranch size={15} /> },
  { key: "erpInterface", label: "Interface ERP", icon: <Link2 size={15} /> },
  { key: "approvers", label: "สิทธิ์เข้าถึง", icon: <ShieldCheck size={15} /> },
];

function parseTabKey(raw: string | null): TabKey {
  if (raw && TABS.some((t) => t.key === raw)) return raw as TabKey;
  return "brands";
}

export default function AccountingSettingsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AccountingSettingsContent />
    </Suspense>
  );
}

function LoadingState() {
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

function NoAccessState() {
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
          หน้านี้สำหรับ IT Admin, System Admin และผู้อนุมัติที่ได้รับสิทธิ์เข้าถึงแท็บตั้งค่าเท่านั้น
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

function AccountingSettingsContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(() => parseTabKey(tabParam));
  const {
    loading: accessLoading,
    isAdmin: accessIsAdmin,
    settingsTabs,
    canSettings,
  } = useAccountingAccess();

  useEffect(() => {
    setActiveTab(parseTabKey(tabParam));
  }, [tabParam]);

  if (status === "loading" || accessLoading) return <LoadingState />;

  // The endpoint's `admin` is the same `isAdminRole(session.user.role)` this
  // page has always computed locally, so keeping the local arm means an
  // unreachable /access endpoint cannot lock an admin out of a page they could
  // open before. It cannot over-grant: every settings route enforces
  // requireRole(["IT Admin", "System Admin"]) for itself.
  const role = session?.user?.role;
  const isAdmin = accessIsAdmin || role === "IT Admin" || role === "System Admin";
  if (!isAdmin && !canSettings) return <NoAccessState />;

  // `settingsTabs` is [] for BOTH an admin (sees everything) and an ungranted
  // non-admin (sees nothing), so `isAdmin` has to be asked first. The non-admin
  // arm re-tests against GRANTABLE_SETTINGS_TABS instead of naming `approvers`
  // by hand — that tab is the one that hands out access, so it must never
  // become reachable by grant, and deriving the rule keeps a seventh tab from
  // leaking in through a list somebody forgot to update.
  const visibleTabs = isAdmin
    ? TABS
    : TABS.filter(
        (t) => isGrantableSettingsTabKey(t.key) && settingsTabs.indexOf(t.key) !== -1,
      );
  if (visibleTabs.length === 0) return <NoAccessState />;

  // A bookmarked `?tab=`, or a grant withdrawn while the page was open, can name
  // a tab this viewer may not open — fall back to the first one they can.
  const effectiveTab = visibleTabs.some((t) => t.key === activeTab)
    ? activeTab
    : visibleTabs[0].key;

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings}
        title="ตั้งค่าเบิกค่าเดินทาง"
        subtitle="จัดการแบรนด์ พาหนะ Interface ERP และสิทธิ์เข้าถึง"
        backHref={backTo("/request/accounting", searchParams.get("from"))}
      />

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div
          className="flex gap-1 px-4 pt-4 pb-0 overflow-x-auto no-scrollbar"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          {visibleTabs.map((tab) => {
            const active = effectiveTab === tab.key;
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
          {effectiveTab === "brands" && <BrandSettings />}
          {effectiveTab === "sameDayBrand" && <SameDayBrandSettings />}
          {effectiveTab === "vehicles" && <VehicleSettings />}
          {effectiveTab === "departments" && <DepartmentMappingSettings />}
          {effectiveTab === "erpInterface" && <BrandErpInterfaceSettings />}
          {effectiveTab === "approvers" && <ApproverSettings />}
        </div>
      </div>
    </PageContainer>
  );
}
