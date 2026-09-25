"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { Link2, ReceiptText, ListTree, MapPin, Pin, Building2, ShieldCheck, MessageSquare } from "lucide-react";
// Building2 no longer labels a tab of this strip — แบรนด์ที่เบิกได้ moved to
// AP-2's page — but it still marks the line below that says where it went.
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ClrErpInterfaceSettings } from "@/features/clear-advance/components/admin/ClrErpInterfaceSettings";
import { ClrGlAccountSettings } from "@/features/clear-advance/components/admin/ClrGlAccountSettings";
import { BuGlAccountSettings } from "@/features/accounting/components/settings/BuGlAccountSettings";
import { ClrLocationSyncPanel } from "@/features/clear-advance/components/admin/ClrLocationSyncPanel";
import { AdvClrAccessSettings } from "@/features/advance/components/settings/AdvClrAccessSettings";
import { CLEAR_SETTINGS_TAB_ORDER } from "@/lib/adv/settings-tabs";

type TabKey = (typeof CLEAR_SETTINGS_TAB_ORDER)[number];

/**
 * The strip, in the order `CLEAR_SETTINGS_TAB_ORDER` declares — AP-2's and
 * AP-4's shape, so the tab order and the grantable-key list cannot drift apart.
 * Two changes on 2026-09-14, both the user's and both matching AP-2: แบรนด์ที่
 * เบิกได้ is its own tab rather than a switch inside Interface ERP, and
 * ผู้อนุมัติ became สิทธิ์เข้าถึง and moved last.
 *
 * **The standalone approver panel came off on 2026-09-22** (the user's
 * instruction), so it is no longer "edited on that tab, beside the grid" as
 * this said. The two TABLES are still separate and that distinction still
 * matters — `AccClearAdvanceApprover` approves money, `AccAdvClrAccess` grants
 * sight — but AP-3's one live role is now a column in the grid itself, ticked
 * to create and unticked to deactivate.
 *
 * "Fix G/L by BU or Branch" is deliberately not called "G/L Account": that
 * would sit one tab to the right of "หมวดบัญชี G/L" — two near-identical names
 * describing different things — so the tab says what the rule DOES, and the pin
 * is the "fix" in it.
 *
 * **แบรนด์ที่เบิกได้ left this strip on 2026-09-22** (the user's decision) and
 * now lives on AP-2's settings page alone. It was never really two tabs:
 * `setBrandActiveShared` MERGEs `AccFormBrand` for `'AP-2'` and `'AP-3'` in one
 * transaction, so a brand is claimable on both forms or neither, and two
 * screens over it were two controls on one row. The banner below the strip is
 * not optional politeness — somebody who has used that tab for a week will look
 * for it, and a control that vanishes with no explanation reads as a bug or a
 * lost permission.
 *
 * **สิทธิ์เข้าถึง shows AP-3's keys only**, from the same date and the same
 * instruction. `AdvClrAccessSettings` derives what it renders from
 * `CLEAR_SETTINGS_TAB_ORDER` itself, so this strip and that grid cannot drift.
 */
const TAB_META: Record<TabKey, { label: string; icon: React.ReactNode }> = {
  glAccounts: { label: "หมวดบัญชี G/L", icon: <ListTree size={15} /> },
  buGlMap: { label: "Fix G/L by BU or Branch", icon: <Pin size={15} /> },
  locations: { label: "Location / BU", icon: <MapPin size={15} /> },
  // Admin-only — `@/lib/adv/settings-tabs` excludes it from
  // `GRANTABLE_ADV_CLR_TABS` because the grant could not be stored:
  // `AccAdvClrAccessTab` is shared with ACC Portal, whose own save rewrites
  // that table through its own key filter, which has never heard of this key.
  // No content is wired to this tab yet — that lands with `FormMessageSettings`.
  clearMessages: { label: "Message", icon: <MessageSquare size={15} /> },
  clearErpInterface: { label: "Interface ERP", icon: <Link2 size={15} /> },
  access: { label: "สิทธิ์เข้าถึง", icon: <ShieldCheck size={15} /> },
};

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] =
  CLEAR_SETTINGS_TAB_ORDER.map((key) => ({ key, ...TAB_META[key] }));

/**
 * `?tab=` → a tab on this strip, honouring one legacy spelling.
 *
 * Interface ERP's key became `clearErpInterface` on 2026-09-22, when the tab
 * became grantable and needed a key per form (see `@/lib/adv/settings-tabs`).
 * A link saved before that names `erpInterface`, and falling through to
 * สิทธิ์เข้าถึง would open the wrong tab rather than saying so.
 */
function parseTabKey(raw: string | null): TabKey {
  if (raw === "erpInterface") return "clearErpInterface";
  return TABS.some((t) => t.key === raw) ? (raw as TabKey) : "access";
}


/**
 * Which tabs of this strip the viewer may open.
 *
 * A **filter, not a control** — every settings route re-decides its own access
 * server-side (`requireAdvClrSettingsTab`), and `settings/access` stays
 * `requireRole` and is not grantable at all. An admin passes everything, so
 * the page behaves exactly as it did before grants existed.
 *
 * **`settings/erp-interface` left that sentence on 2026-09-22**, with
 * `gl-accounts` and `bu-gl-map`, when the user opened all three to individual
 * grants — see `@/lib/adv/settings-tabs` for what each one reaches. The
 * routes that write `Rocks_ERP_Data` (`vendors/sync`, `erp-sync`,
 * `locations/sync`) did NOT, and stay admin-only.
 *
 * `undefined` while the fetch is in flight, which is what keeps the page from
 * flashing its refusal at somebody who does have access.
 */
function useVisibleTabs() {
  const { data } = useSWR<{
    ok: boolean;
    data?: { isAdmin: boolean; settingsTabs: Record<string, boolean> };
  }>("/api/request/advance/access", (url: string) => fetch(url).then((r) => r.json()));
  if (!data) return undefined;
  const d = data.ok ? data.data : undefined;
  if (!d) return [];
  if (d.isAdmin) return TABS;
  return TABS.filter((t) => d.settingsTabs?.[t.key]);
}

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
  const { status } = useSession();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(() => parseTabKey(tabParam));
  // Every hook before any early return: this one used to sit below the
  // session-loading branch, which is a conditional call and breaks the Rules
  // of Hooks the moment that branch is taken.
  const visibleTabs = useVisibleTabs();

  if (status === "loading") {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <div className="flex items-center justify-center py-20">
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
        </div>
      </PageContainer>
    );
  }

  if (!visibleTabs) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <div className="flex items-center justify-center py-20">
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
        </div>
      </PageContainer>
    );
  }
  /* A ?tab= link, or the default, can name a tab this viewer cannot open —
     show the first one they CAN rather than an empty panel. Derived rather
     than pushed into state, so it re-resolves if the grants change under the
     page. */
  const openTab = visibleTabs.some((t) => t.key === activeTab)
    ? activeTab
    : visibleTabs[0]?.key;

  if (visibleTabs.length === 0) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <div className="rounded-2xl py-16 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <p className="text-[32px] mb-3">🔒</p>
          <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>ไม่มีสิทธิ์เข้าถึง</h2>
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>หน้านี้สำหรับผู้ดูแลระบบ หรือผู้ที่ได้รับสิทธิ์จากแท็บ สิทธิ์เข้าถึง</p>
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
        subtitle="หมวดบัญชี G/L · Fix G/L by BU or Branch · Location / BU · Interface ERP · สิทธิ์เข้าถึง"
        backHref={backTo("/request/clear-advance/admin", searchParams.get("from"))}
      />

      <div className="rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div className="flex gap-1 px-4 pt-4 pb-0 overflow-x-auto no-scrollbar"
          style={{ borderBottom: "1px solid var(--border-card)" }}>
          {visibleTabs.map((tab) => {
            const active = openTab === tab.key;
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

        {/* Where แบรนด์ที่เบิกได้ went. Outside the panel and above every tab,
            not on one of them: the person looking for it does not know which
            tab to open, which is the whole reason they are looking. */}
        <div className="px-5 pt-4">
          <p className="text-[11px] m-0 px-3 py-2 rounded-lg flex items-start gap-1.5"
            style={{
              background: "var(--nav-active-bg)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-card)",
            }}>
            <Building2 size={13} className="shrink-0 mt-0.5" style={{ color: "var(--nav-active-text)" }} />
            <span>
              <b>แบรนด์ที่เบิกได้</b> ย้ายไปอยู่ที่{" "}
              <Link href="/request/advance/settings?tab=brands" className="font-semibold underline"
                style={{ color: "var(--nav-active-text)" }}>
                ตั้งค่าเบิกเงินทดรองจ่าย (AP-2) → แบรนด์ที่เบิกได้
              </Link>{" "}
              — เป็นสวิตช์เดียวกัน เปิด/ปิดที่นั่นมีผลกับ AP-3 ด้วย
            </span>
          </p>
        </div>

        <div className="p-5">
          {openTab === "clearErpInterface" && <ClrErpInterfaceSettings />}
          {/* The same screen AP-4 shows, over the same rows — only the path
              differs, and it has to. See BuGlAccountSettings' own docblock. */}
          {openTab === "buGlMap" && (
            <BuGlAccountSettings
              endpoint="/api/request/clear-advance/settings/bu-gl-map"
              syncEndpoint="/api/request/clear-advance/settings/erp-sync"
              sharedNote="กฎนี้ใช้ร่วมกับ AP-4 (ขอเบิกเงินคืนพนักงาน) — เป็นข้อมูลชุดเดียวกัน แก้ที่นี่มีผลกับทั้งสองฟอร์ม"
            />
          )}
          {openTab === "glAccounts" && <ClrGlAccountSettings />}
          {openTab === "locations" && <ClrLocationSyncPanel />}
          {/* The standalone approver panel is GONE (user, 2026-09-22: "ส่วนนี้
              ตัดออกได้เลยเพราะ มีอยู่ที่ตารางด้านบนแล้ว"). AP-3's one live role is
              a column in the grid above — ticking creates the approver row,
              unticking deactivates it — so the panel had become a second editor
              over the same rows.

              The panel's HARD DELETE goes with it, which is the established
              direction here rather than a regression: every other roster in
              this app soft-deletes and says so. Adding is unaffected. */}
          {openTab === "access" && <AdvClrAccessSettings form="AP-3" />}
        </div>
      </div>
    </PageContainer>
  );
}
