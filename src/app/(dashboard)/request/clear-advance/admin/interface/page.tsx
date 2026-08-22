"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Undo2 } from "lucide-react";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { ClrErpInterfaceQueue } from "@/features/clear-advance/components/admin/ClrErpInterfaceQueue";

export default function ClrErpInterfacePage() {
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
      <ClrErpInterfacePageContent />
    </Suspense>
  );
}

function ClrErpInterfacePageContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();

  if (status === "loading") {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <div className="flex items-center justify-center py-20">
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
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
            href="/request/clear-advance/admin"
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
        icon={Undo2}
        title="Interface ERP (AP-3)"
        subtitle="ส่งคำขอเคลียร์เงินทดรองที่อนุมัติแล้วเข้า Business Central"
        backHref={backTo("/request/clear-advance/admin", searchParams.get("from"))}
      />
      <ClrErpInterfaceQueue />
    </PageContainer>
  );
}
