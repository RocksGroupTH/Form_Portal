"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ThumbsUp, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { ReimburseApprovalQueue } from "@/features/reimburse/ReimburseApprovalQueue";
import { ReimburseErpQueue } from "@/features/reimburse/ReimburseErpQueue";

/**
 * /request/reimburse/approvals — AP-4's accounting queue, now two tabs.
 *
 * **This page owns the shell; `ReimburseApprovalQueue` and `ReimburseErpQueue`
 * are body-only.** AP-1, AP-2 and AP-3 all give the ERP queue its own tab
 * rather than its own route, and `/request/clear-advance/admin/approvals/page.tsx`
 * is the model this file copies: the `parseTab`/`setTab`/`TABS` shape, the
 * `?tab=interface` convention (the default tab carries no query param), and
 * the `<Suspense>` wrapper `useSearchParams` requires.
 *
 * **`ReimburseApprovalQueue` keeps its own outer card**, unlike AP-3's
 * `ClrApprovalsQueue`/`ClrErpInterfaceQueue`, which render body content only
 * and rely on their page's shared `rounded-2xl` card for the border and
 * background. Wrapping `ReimburseApprovalQueue` in a second such card here
 * would nest two bordered boxes around the same content; leaving its own card
 * alone keeps the existing tab's screen exactly as it rendered before this
 * split, tab strip aside. `ReimburseErpQueue` was written the same way for the
 * same reason, so both tabs' bodies carry equivalent chrome.
 *
 * Header icon/title/backHref are the exact values `ReimburseApprovalQueue`
 * rendered on its own `PageHeaderBar` before this split; the subtitle now
 * varies per tab, which the brief calls a nice-to-have, not a requirement.
 */

type TabKey = "approve" | "interface";

const TABS: { key: TabKey; label: string; icon: React.ReactNode; subtitle: string }[] = [
  {
    key: "approve",
    label: "รออนุมัติ",
    icon: <ThumbsUp size={15} />,
    subtitle: "รายการที่ผู้จัดการอนุมัติแล้ว รอบัญชีเลือกวันที่จ่ายและส่งต่อขั้นสุดท้าย",
  },
  {
    key: "interface",
    label: "Interface ERP",
    icon: <Upload size={15} />,
    subtitle: "รายการที่อนุมัติแล้ว รอส่งเข้า Business Central",
  },
];

function parseTab(raw: string | null): TabKey {
  return raw === "interface" ? "interface" : "approve";
}

function ApprovalsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);

  const setTab = useCallback(
    (tab: TabKey) => {
      const q = new URLSearchParams(searchParams.toString());
      if (tab === "approve") q.delete("tab");
      else q.set("tab", tab);
      const qs = q.toString();
      router.replace(qs ? `/request/reimburse/approvals?${qs}` : "/request/reimburse/approvals", { scroll: false });
    },
    [router, searchParams],
  );

  const tabMeta = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={ThumbsUp}
        title="คิวอนุมัติ (บัญชี) — ขอเบิกเงินคืนพนักงาน"
        titleExtra={<FormEnvironmentChip formCode="AP-4" />}
        subtitle={tabMeta.subtitle}
        // The hub, not `/request/reimburse` — that is the REQUESTER's fill
        // form, and the only entry point to this page is the card on
        // `/request`. AP-17's equivalent queue backs to its hub for the same
        // reason.
        backHref="/request"
      />

      <div className="flex items-center gap-1 mb-4" style={{ borderBottom: "1px solid var(--border-card)" }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTab(tab.key)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold cursor-pointer border-none bg-transparent rounded-t-lg transition-colors"
              style={{
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

      {activeTab === "approve" ? <ReimburseApprovalQueue /> : <ReimburseErpQueue />}
    </PageContainer>
  );
}

export default function ReimburseApprovalsPage() {
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
      <ApprovalsContent />
    </Suspense>
  );
}
