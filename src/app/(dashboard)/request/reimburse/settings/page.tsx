"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Building2, FileCheck, Settings, Users } from "lucide-react";
import { requestBackHref } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ReimburseApproverSettings } from "@/features/reimburse/components/settings/ReimburseApproverSettings";
import { ReimburseRuleSettings } from "@/features/reimburse/components/settings/ReimburseRuleSettings";
import { ReimburseBrandSettings } from "@/features/reimburse/components/settings/ReimburseBrandSettings";

/**
 * AP-4 settings — the accounting approver pool, the acknowledgement checklist
 * and the brand allowlist.
 *
 * Laid out as AP-1's `/request/accounting/settings` is: a tab strip inside one
 * card, each tab a feature component that owns its own fetching. The two pages
 * should be indistinguishable apart from what is on them.
 *
 * **Approvers is the default tab**, where AP-1 also opens on approvers, and here
 * for a sharper reason: `AccReimburseApprover` ships empty, and until it has two
 * active rows every AP-4 request stops at the accounting step with
 * "ไม่มีสิทธิ์ — คุณไม่ได้อยู่ในรายชื่อผู้อนุมัติฝ่ายบัญชีของแบบฟอร์ม AP-4". The
 * first thing anybody opening this page needs to do is the first thing they see.
 *
 * IT Admin / System Admin, matching `requireRole` on every route behind it and
 * on AP-1's settings routes. The gate here is presentational — each route checks
 * the role again for itself.
 */

type TabKey = "approvers" | "rules" | "brands";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "approvers", label: "ผู้อนุมัติบัญชี", icon: <Users size={15} /> },
  { key: "rules", label: "ระเบียบการจ่าย", icon: <FileCheck size={15} /> },
  { key: "brands", label: "แบรนด์ที่เบิกได้", icon: <Building2 size={15} /> },
];

function parseTabKey(raw: string | null): TabKey {
  if (raw && TABS.some((t) => t.key === raw)) return raw as TabKey;
  return "approvers";
}

export default function ReimburseSettingsPage() {
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
      <ReimburseSettingsContent />
    </Suspense>
  );
}

function ReimburseSettingsContent() {
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

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings}
        title="ตั้งค่าขอเบิกเงินคืนพนักงาน"
        subtitle="AP-4 · ผู้อนุมัติฝ่ายบัญชี ระเบียบการจ่าย และแบรนด์ที่เบิกได้"
        backHref={requestBackHref(searchParams.get("from"))}
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
          {activeTab === "approvers" && <ReimburseApproverSettings />}
          {activeTab === "rules" && <ReimburseRuleSettings />}
          {activeTab === "brands" && <ReimburseBrandSettings />}
        </div>
      </div>
    </PageContainer>
  );
}
