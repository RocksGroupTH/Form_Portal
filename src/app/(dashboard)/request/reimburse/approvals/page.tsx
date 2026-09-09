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
 * is the model this file copies — not just its `parseTab`/`setTab`/`TABS`
 * shape and `?tab=interface` convention, but the ENCLOSED tab shape every
 * other tabbed page in this app shares (including AP-4's own settings page
 * one click away): one page-level `rounded-2xl` card holding the strip
 * (`px-4 pt-4`, active tab `background: var(--bg-card)`, `shrink-0` buttons,
 * `overflow-x-auto no-scrollbar` so narrow viewports scroll the strip rather
 * than compressing its labels) plus a `p-5` body. An earlier version of this
 * page put the strip directly on the page background with neither of those —
 * caught in review because it was measurably different from every sibling
 * tabbed page, not because it looked wrong in isolation.
 *
 * **Both bodies are chrome-less**, relying on this card for their border and
 * background rather than carrying a second one of their own — the same as
 * AP-3's `ClrApprovalsQueue`/`ClrErpInterfaceQueue`. `ReimburseApprovalQueue`
 * keeps only its OWN conditional `pb-24` (space for its sticky bottom action
 * bar), which is about its own content, not chrome.
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
        // AP-4's own hub, `/request/reimburse/admin` — not `/request/reimburse`,
        // which is the REQUESTER's fill form. This used to back straight to
        // `/request` on the claim that the card there was the only entry
        // point; that stopped being true once AP-4 gained a hub of its own
        // (Task 5) the way AP-1, AP-2, AP-3 and AP-17 already had, and
        // `/request` no longer even carries a card that names this page
        // directly. AP-17's equivalent queue backs to its hub for the same
        // reason.
        backHref="/request/reimburse/admin"
      />

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div
          className="flex gap-1 px-4 pt-4 pb-0 overflow-x-auto overflow-y-hidden no-scrollbar"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTab(tab.key)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold cursor-pointer border-none rounded-t-lg transition-colors shrink-0"
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
          {activeTab === "approve" ? <ReimburseApprovalQueue /> : <ReimburseErpQueue />}
        </div>
      </div>
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
