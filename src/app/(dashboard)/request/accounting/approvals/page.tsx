"use client";

import { Suspense, useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ApprovalsQueue } from "@/features/accounting/components/ApprovalsQueue";
import { ErpPrepQueue } from "@/features/accounting/components/ErpPrepQueue";
import { ErpEnvironmentBanner } from "@/features/accounting/components/ErpEnvironmentBanner";
import { AccountApproverGuard } from "@/features/accounting/components/AccountApproverGuard";
import { useApproverInterfaceAccess } from "@/features/accounting/hooks/useApproverInterfaceAccess";
import { parseInterfaceTargetForAccess } from "@/features/accounting/lib/erp-interface-target";
import { filterInterfaceBrandCodes } from "@/lib/acc/approver-interface-access-shared";
import { ClipboardCheck, Upload } from "lucide-react";

type TabKey = "approve" | "interface";

const TABS: { key: TabKey; label: string; icon: React.ReactNode; subtitle: string }[] = [
  {
    key: "approve",
    label: "รออนุมัติ",
    icon: <ClipboardCheck size={15} />,
    subtitle: "เลือกหลายรายการ ตรวจสอบ แล้วอนุมัติพร้อมกัน — คลิกไอคอนตาเพื่อดูรายละเอียดเต็ม",
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

export default function AccountingApprovalsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer className="acc-theme py-6 px-3 sm:px-0">
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            กำลังโหลด...
          </p>
        </PageContainer>
      }
    >
      <AccountingApprovalsContent />
    </Suspense>
  );
}

function AccountingApprovalsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { access, ready: accessReady } = useApproverInterfaceAccess();
  const visibleCodes = useMemo(() => filterInterfaceBrandCodes(access), [access]);
  const activeTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const interfaceTarget = useMemo(
    () => parseInterfaceTargetForAccess(searchParams.get("iface"), access),
    [searchParams, access],
  );

  useEffect(() => {
    if (!accessReady) return;
    const raw = searchParams.get("iface")?.trim().toUpperCase();
    if (raw && raw === interfaceTarget) return;
    if (!raw && interfaceTarget === parseInterfaceTargetForAccess(null, access)) return;
    const q = new URLSearchParams(searchParams.toString());
    q.set("iface", interfaceTarget);
    router.replace(`/request/accounting/approvals?${q.toString()}`, { scroll: false });
  }, [interfaceTarget, searchParams, router, access, accessReady]);

  const setTab = useCallback(
    (tab: TabKey) => {
      const q = new URLSearchParams(searchParams.toString());
      if (tab === "approve") q.delete("tab");
      else q.set("tab", tab);
      const qs = q.toString();
      router.replace(qs ? `/request/accounting/approvals?${qs}` : "/request/accounting/approvals", {
        scroll: false,
      });
    },
    [router, searchParams],
  );

  const setInterfaceTarget = useCallback(
    (code: string) => {
      const q = new URLSearchParams(searchParams.toString());
      q.set("iface", code.trim().toUpperCase());
      const qs = q.toString();
      router.replace(`/request/accounting/approvals?${qs}`, { scroll: false });
    },
    [router, searchParams],
  );

  const tabMeta = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <AccountApproverGuard>
      <ErpEnvironmentBanner />
      <PageHeaderBar
        icon={ClipboardCheck}
        title="อนุมัติเบิกค่าเดินทาง (บัญชี)"
        subtitle={tabMeta.subtitle}
        backHref={backTo("/request/accounting", searchParams.get("from"))}
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
          {!accessReady ? (
            <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
              กำลังโหลดสิทธิ์กลุ่ม Interface...
            </p>
          ) : activeTab === "approve" ? (
            <ApprovalsQueue
              interfaceTarget={interfaceTarget}
              onInterfaceTargetChange={setInterfaceTarget}
              visibleInterfaceCodes={access.allAccess ? null : visibleCodes}
              showUnassignedTab={access.allAccess}
            />
          ) : (
            <ErpPrepQueue
              interfaceTarget={interfaceTarget}
              onInterfaceTargetChange={setInterfaceTarget}
              visibleInterfaceCodes={access.allAccess ? null : visibleCodes}
              showUnassignedTab={access.allAccess}
            />
          )}
        </div>
      </div>
      </AccountApproverGuard>
    </PageContainer>
  );
}
