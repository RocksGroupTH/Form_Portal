"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Settings, Compass, Hotel, Car, Plane, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { backTo } from "@/lib/request-hub-nav";
import {
  GRANTABLE_BOOKING_TABS,
  isGrantableBookingTabKey,
} from "@/lib/acc/travel-booking/settings-tabs";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { useBookingAccess } from "@/features/travel-booking/hooks/useBookingAccess";
import { TravelOptionSettings, type TravelOptionKind } from "@/features/travel-booking/components/settings/TravelOptionSettings";
import { BookingApproverSettings } from "@/features/travel-booking/components/settings/BookingApproverSettings";

/**
 * Four of the five tabs are option tables driven by `TravelOptionSettings`.
 * The fifth, `access`, is AP-17's own approver roster and renders its own
 * panel — hence the union rather than a bare `TravelOptionKind`.
 *
 * An admin sees all five. A non-admin booking approver sees only the tabs
 * granted to them in `AccBookingApproverTab`, and never `access`: that is where
 * the grants are handed out, so it is absent from `GRANTABLE_BOOKING_TABS` and
 * refused server-side by `decideBookingTabAccess` whatever a grant row says.
 */
type TabKey = TravelOptionKind | "access";

/**
 * Icons are the only thing this page still owns about a tab. The **labels come
 * from `GRANTABLE_BOOKING_TABS`**, which is also what the สิทธิ์เข้าถึง panel
 * builds its checkbox columns from — a second copy here would let the tab strip
 * and the checkbox that grants it end up naming different things.
 */
const TAB_ICONS: Record<TabKey, React.ReactNode> = {
  reasons: <Compass size={15} />,
  accommodations: <Hotel size={15} />,
  vehicles: <Plane size={15} />,
  "rent-vehicles": <Car size={15} />,
  access: <ShieldCheck size={15} />,
};

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] =
  GRANTABLE_BOOKING_TABS.map((t) => ({
    key: t.key as TabKey,
    label: t.label,
    icon: TAB_ICONS[t.key],
  })).concat([{ key: "access", label: "สิทธิ์เข้าถึง", icon: TAB_ICONS.access }]);

/** Per-tab panel copy. The heading label is taken from `TABS`, not repeated. */
const TAB_PANELS: Record<
  TravelOptionKind,
  { addLabel: string; namePlaceholder: string; emptyIcon: string; emptyLabel: string }
> = {
  reasons: {
    addLabel: "เพิ่มเหตุผล",
    namePlaceholder: "เช่น ประชุมลูกค้า",
    emptyIcon: "🧭",
    emptyLabel: "ยังไม่มีเหตุผลการเดินทาง",
  },
  accommodations: {
    addLabel: "เพิ่มที่พัก",
    namePlaceholder: "เช่น โรงแรมบริษัทจัดหา",
    emptyIcon: "🏨",
    emptyLabel: "ยังไม่มีตัวเลือกที่พัก",
  },
  vehicles: {
    addLabel: "เพิ่มยานพาหนะ",
    namePlaceholder: "เช่น รถยนต์ส่วนตัว",
    emptyIcon: "✈️",
    emptyLabel: "ยังไม่มียานพาหนะ",
  },
  "rent-vehicles": {
    addLabel: "เพิ่มรายการเช่า",
    namePlaceholder: "เช่น เช่ารถตู้",
    emptyIcon: "🚐",
    emptyLabel: "ยังไม่มีรายการเช่ายานพาหนะ",
  },
};

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

export default function TravelBookingSettingsPage() {
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<TabKey>("reasons");
  const {
    loading: accessLoading,
    isAdmin: accessIsAdmin,
    settingsTabs,
    canSettings,
  } = useBookingAccess();

  if (status === "loading" || accessLoading) return <LoadingState />;

  // The endpoint's `admin` is the same `isAdminRole(session.user.role)` this
  // page used to compute on its own, so keeping the local arm means an
  // unreachable /access endpoint cannot strip a real admin from a page they
  // could open before. It cannot over-grant: the literal test is a strict
  // subset of the server's `isAdminRole` over the same session value, and every
  // AP-17 settings route re-derives the role itself inside
  // `requireBookingSettingsTab` (or `requireRole`, on สิทธิ์เข้าถึง). What is
  // decided here is only what is *offered*.
  const role = session?.user?.role;
  const isAdmin = accessIsAdmin || role === "IT Admin" || role === "System Admin";
  if (!isAdmin && !canSettings) return <NoAccessState />;

  // `settingsTabs` is [] for BOTH an admin (sees everything) and an ungranted
  // non-admin (sees nothing), so `isAdmin` has to be asked first. The non-admin
  // arm re-tests with `isGrantableBookingTabKey` rather than naming `access` by
  // hand: that tab hands out the grants, so it must never become reachable
  // through one, and deriving the rule keeps a sixth tab from leaking in
  // through a list somebody forgot to update.
  const visibleTabs = isAdmin
    ? TABS
    : TABS.filter(
        (t) => isGrantableBookingTabKey(t.key) && settingsTabs.indexOf(t.key) !== -1,
      );
  if (visibleTabs.length === 0) return <NoAccessState />;

  // A grant withdrawn while the page was open — or simply the default first tab
  // for someone who was not granted it — can name a tab this viewer may not
  // open. Fall back to the first one they can.
  const effectiveTab = visibleTabs.some((t) => t.key === activeTab)
    ? activeTab
    : visibleTabs[0].key;
  const panel = effectiveTab === "access" ? null : TAB_PANELS[effectiveTab];
  const panelLabel = visibleTabs.filter((t) => t.key === effectiveTab)[0]?.label ?? "";

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings}
        title="ตั้งค่าแบบฟอร์มขอเดินทาง (AP-17)"
        subtitle="จัดการเหตุผลการเดินทาง ที่พัก ยานพาหนะ รายการเช่ายานพาหนะ และสิทธิ์เข้าถึง"
        backHref={backTo("/request/accounting/travel-booking", searchParams.get("from"))}
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
          {effectiveTab === "access" || panel === null ? (
            <BookingApproverSettings />
          ) : (
            <TravelOptionSettings
              key={effectiveTab}
              kind={effectiveTab}
              label={panelLabel}
              addLabel={panel.addLabel}
              namePlaceholder={panel.namePlaceholder}
              emptyIcon={panel.emptyIcon}
              emptyLabel={panel.emptyLabel}
            />
          )}
        </div>
      </div>
    </PageContainer>
  );
}
