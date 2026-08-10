"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Settings, Compass, Hotel, Car, Plane } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { TravelOptionSettings, type TravelOptionKind } from "@/features/travel-booking/components/settings/TravelOptionSettings";

type TabKey = TravelOptionKind;

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "reasons", label: "เหตุผลการเดินทาง", icon: <Compass size={15} /> },
  { key: "accommodations", label: "ที่พัก", icon: <Hotel size={15} /> },
  { key: "vehicles", label: "การเดินทาง", icon: <Plane size={15} /> },
  { key: "rent-vehicles", label: "เช่ายานพาหนะ", icon: <Car size={15} /> },
];

const TAB_PANELS: Record<
  TabKey,
  { label: string; addLabel: string; namePlaceholder: string; emptyIcon: string; emptyLabel: string }
> = {
  reasons: {
    label: "เหตุผลการเดินทาง",
    addLabel: "เพิ่มเหตุผล",
    namePlaceholder: "เช่น ประชุมลูกค้า",
    emptyIcon: "🧭",
    emptyLabel: "ยังไม่มีเหตุผลการเดินทาง",
  },
  accommodations: {
    label: "ที่พัก",
    addLabel: "เพิ่มที่พัก",
    namePlaceholder: "เช่น โรงแรมบริษัทจัดหา",
    emptyIcon: "🏨",
    emptyLabel: "ยังไม่มีตัวเลือกที่พัก",
  },
  vehicles: {
    label: "การเดินทาง",
    addLabel: "เพิ่มยานพาหนะ",
    namePlaceholder: "เช่น รถยนต์ส่วนตัว",
    emptyIcon: "✈️",
    emptyLabel: "ยังไม่มียานพาหนะ",
  },
  "rent-vehicles": {
    label: "เช่ายานพาหนะ",
    addLabel: "เพิ่มรายการเช่า",
    namePlaceholder: "เช่น เช่ารถตู้",
    emptyIcon: "🚐",
    emptyLabel: "ยังไม่มีรายการเช่ายานพาหนะ",
  },
};

export default function TravelBookingSettingsPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<TabKey>("reasons");

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

  const panel = TAB_PANELS[activeTab];

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings}
        title="ตั้งค่าแบบฟอร์มขอเดินทาง (AP-17)"
        subtitle="จัดการเหตุผลการเดินทาง ที่พัก ยานพาหนะ และรายการเช่ายานพาหนะ"
        backHref="/request/accounting/travel-booking"
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
          <TravelOptionSettings
            key={activeTab}
            kind={activeTab}
            label={panel.label}
            addLabel={panel.addLabel}
            namePlaceholder={panel.namePlaceholder}
            emptyIcon={panel.emptyIcon}
            emptyLabel={panel.emptyLabel}
          />
        </div>
      </div>
    </PageContainer>
  );
}
