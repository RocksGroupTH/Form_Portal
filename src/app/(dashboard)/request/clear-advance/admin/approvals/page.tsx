"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardCheck, Upload } from "lucide-react";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { ClrApprovalsQueue } from "@/features/clear-advance/components/admin/ClrApprovalsQueue";
import { ClrErpInterfaceQueue } from "@/features/clear-advance/components/admin/ClrErpInterfaceQueue";

type TabKey = "approve" | "interface";

const TABS: { key: TabKey; label: string; icon: React.ReactNode; subtitle: string }[] = [
  {
    key: "approve",
    label: "รออนุมัติ",
    icon: <ClipboardCheck size={15} />,
    subtitle: "คำขอเคลียร์เงินทดรองที่รออนุมัติ — เปิดรายการเพื่ออนุมัติ/ปฏิเสธ",
  },
  {
    key: "interface",
    label: "Interface ERP",
    icon: <Upload size={15} />,
    subtitle: "รายการที่อนุมัติแล้ว — ตรวจสอบข้อมูลก่อนส่ง Interface ไป Business Central",
  },
];

function parseTab(raw: string | null): TabKey {
  return raw === "interface" ? "interface" : "approve";
}

function ApprovalsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const activeTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);

  const setTab = useCallback(
    (tab: TabKey) => {
      const q = new URLSearchParams(searchParams.toString());
      if (tab === "approve") q.delete("tab");
      else q.set("tab", tab);
      const qs = q.toString();
      router.replace(
        qs ? `/request/clear-advance/admin/approvals?${qs}` : "/request/clear-advance/admin/approvals",
        { scroll: false },
      );
    },
    [router, searchParams],
  );

  const tabMeta = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={ClipboardCheck}
        title="รออนุมัติ AP-3"
        titleExtra={<FormEnvironmentChip formCode="AP-3" />}
        subtitle={tabMeta.subtitle}
        backHref={backTo("/request/clear-advance/admin", from)}
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
          {activeTab === "approve" ? (
            <ClrApprovalsQueue from={from} />
          ) : (
            <ClrErpInterfaceQueue />
          )}
        </div>
      </div>
    </PageContainer>
  );
}

export default function ClearAdvanceApprovalsPage() {
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
