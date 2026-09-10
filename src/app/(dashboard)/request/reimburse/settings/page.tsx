"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Building2, FileCheck, Link2, Settings, ShieldCheck } from "lucide-react";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ReimburseRuleSettings } from "@/features/reimburse/components/settings/ReimburseRuleSettings";
import { ReimburseBrandSettings } from "@/features/reimburse/components/settings/ReimburseBrandSettings";
import { ReimburseAccessSettings } from "@/features/reimburse/components/settings/ReimburseAccessSettings";
import { ReimburseErpInterfaceSettings } from "@/features/reimburse/components/settings/ReimburseErpInterfaceSettings";
import { useReimburseAccess } from "@/features/reimburse/hooks/useReimburseAccess";
import {
  REIMBURSE_SETTINGS_TAB_ORDER,
  type ReimburseSettingsTabKey,
} from "@/lib/acc/reimburse/settings-tabs";

/**
 * AP-4 settings — the acknowledgement checklist, the brand allowlist, AP-4's
 * own Business Central posting configuration, and สิทธิ์เข้าถึง, which now
 * carries both the per-person tab grants and the accounting-approver roster
 * on one grid.
 *
 * Laid out as AP-1's `/request/accounting/settings` is: a tab strip inside one
 * card, each tab a feature component that owns its own fetching. The two pages
 * should be indistinguishable apart from what is on them.
 *
 * **สิทธิ์เข้าถึง is the default tab, and is deliberately not the first one.**
 * The strip runs configuration-first — brands, rules, erpInterface — but the
 * page opens on สิทธิ์เข้าถึง, as AP-1's opened on its own approver tab, and
 * here for the same sharp reason as before 2026-09-10: `AccReimburseApprover`
 * ships empty, and until two people each have at least one brand ticked on
 * this grid, every AP-4 request stops at the accounting step with
 * "ไม่มีสิทธิ์ — คุณไม่ได้อยู่ในรายชื่อผู้อนุมัติฝ่ายบัญชีของแบบฟอร์ม AP-4". The one
 * thing that blocks the whole form is the thing anybody opening this page
 * should land on, whatever order the tabs read in. There used to be a separate
 * ผู้อนุมัติบัญชี tab carrying that same warning; removing it did not remove the
 * reason to open here first, it just moved the fix onto this tab's own grid.
 *
 * **สิทธิ์เข้าถึง is last on the strip, and it is not merely a settings-tab
 * grant list any more.** `AccReimburseApprover` (who may take the two
 * accounting approval steps on real payments, scoped by brand since migration
 * 144) and `AccReimburseAccess` (`settings/access`, migration 120 — who may
 * open which of the OTHER tabs) are still two separate tables, never merged —
 * see `settings-tabs.ts`'s module docblock. What merged is this one screen:
 * ticking ≥1 brand on a row is what makes that person an active
 * `AccReimburseApprover`, alongside whatever settings-tab ticks the same row
 * carries. A person can hold one without the other.
 *
 * **Who reaches this page** is no longer role alone. An IT Admin or System Admin
 * sees every tab, as before. A non-admin holding at least one grant sees only
 * the tabs they hold — never `erpInterface` or `access`, neither of which is
 * grantable — and every route behind those tabs re-resolves the grant
 * server-side on each call (`requireReimburseSettingsTab`). The gate here is
 * presentational. `erpInterface`'s own route stays `requireRole` outright —
 * see `settings-tabs.ts` for why it is not brand-scoped and therefore not safe
 * to hand to a scoped approver yet.
 */

type TabKey = ReimburseSettingsTabKey;

const TAB_META: Record<TabKey, { label: string; icon: React.ReactNode }> = {
  rules: { label: "ระเบียบการจ่าย", icon: <FileCheck size={15} /> },
  brands: { label: "แบรนด์ที่เบิกได้", icon: <Building2 size={15} /> },
  erpInterface: { label: "Interface ERP", icon: <Link2 size={15} /> },
  access: { label: "สิทธิ์เข้าถึง", icon: <ShieldCheck size={15} /> },
};

/**
 * The strip, in the order `REIMBURSE_SETTINGS_TAB_ORDER` declares — the same
 * constant `GRANTABLE_REIMBURSE_TABS` is filtered from, so the checkbox columns
 * on the สิทธิ์เข้าถึง tab and the tabs themselves cannot drift apart.
 */
const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] =
  REIMBURSE_SETTINGS_TAB_ORDER.map((key) => ({ key, ...TAB_META[key] }));

function parseTabKey(raw: string | null): TabKey {
  if (raw && TABS.some((t) => t.key === raw)) return raw as TabKey;
  return "access";
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
          หน้านี้สำหรับ IT Admin, System Admin และผู้ที่ได้รับสิทธิ์เข้าถึงเท่านั้น
        </p>
        <Link
          href="/request"
          className="inline-block mt-4 text-[12px] px-4 py-2 rounded-lg no-underline font-medium"
          style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </PageContainer>
  );
}

export default function ReimburseSettingsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReimburseSettingsContent />
    </Suspense>
  );
}

function ReimburseSettingsContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(() => parseTabKey(tabParam));
  const {
    loading: accessLoading,
    isAdmin: accessIsAdmin,
    settingsTabs,
    canSettings,
  } = useReimburseAccess();

  useEffect(() => {
    setActiveTab(parseTabKey(tabParam));
  }, [tabParam]);

  if (status === "loading" || accessLoading) return <LoadingState />;

  // The endpoint's `admin` is the same `isAdminRole(session.user.role)` the
  // routes derive, so the two agree; the session role is kept as a second source
  // so an unreadable access payload cannot lock an admin out of their own
  // settings page. Every route re-derives the role for itself regardless.
  const role = session?.user?.role;
  const isAdmin = accessIsAdmin || role === "IT Admin" || role === "System Admin";
  if (!isAdmin && !canSettings) return <NoAccessState />;

  // Admins see everything; a granted non-admin sees only what they hold. The
  // `isAdmin` arm has to come first — `settingsTabs` is `[]` for an admin, so
  // filtering on it alone would show them nothing.
  const visibleTabs = isAdmin
    ? TABS
    : TABS.filter((t) => settingsTabs.indexOf(t.key) !== -1);

  // `?tab=` can name a tab this viewer does not hold, and `parseTabKey` only
  // checks that it is a real one. Fall back to the first tab they actually have
  // rather than rendering a panel whose every request will 403.
  const shownTab = visibleTabs.some((t) => t.key === activeTab)
    ? activeTab
    : visibleTabs[0]?.key;
  if (!shownTab) return <NoAccessState />;

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings}
        title="ตั้งค่าขอเบิกเงินคืนพนักงาน"
        subtitle="AP-4 · แบรนด์ที่เบิกได้ ระเบียบการจ่าย Interface ERP และสิทธิ์เข้าถึง (รวมผู้อนุมัติฝ่ายบัญชี)"
        // AP-4's hub, not `/request`. `requestBackHref` was correct while this
        // page WAS a card on the hub — there was nothing in between to go back
        // to. Task 5 put `/request/reimburse/admin` between them, so backing
        // past it skipped a level, which is what every sibling settings page
        // already avoided: AP-2's is `backTo("/request/advance/admin", …)`.
        // `backTo` keeps the `?from=admin` tag so Back still reaches the
        // management-only view for somebody who came through Settings →
        // Accounting Admin.
        backHref={backTo("/request/reimburse/admin", searchParams.get("from"))}
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
            const active = shownTab === tab.key;
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
          {shownTab === "rules" && <ReimburseRuleSettings />}
          {shownTab === "brands" && <ReimburseBrandSettings />}
          {shownTab === "erpInterface" && <ReimburseErpInterfaceSettings />}
          {shownTab === "access" && <ReimburseAccessSettings />}
        </div>
      </div>
    </PageContainer>
  );
}
