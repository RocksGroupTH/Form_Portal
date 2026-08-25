"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { requestBackHref, withReturnTag } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { HoverCard } from "@/components/ui/HoverCard";
import {
  Undo2,
  ClipboardCheck,
  FileBarChart,
  FileSpreadsheet,
  SlidersHorizontal,
} from "lucide-react";

interface HubCard {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
}

const CARDS: HubCard[] = [
  {
    title: "ตั้งค่า (Interface ERP / ผู้อนุมัติ)",
    desc: "หน้าตั้งค่า AP-3 แบบแท็บ · Interface ERP (Journal Batch ต่อแบรนด์) และผู้อนุมัติ",
    href: "/request/clear-advance/settings",
    icon: <SlidersHorizontal size={20} />,
  },
  {
    title: "รออนุมัติ",
    desc: "คำขอเคลียร์เงินทดรองที่รออนุมัติ (บัญชี / หัวหน้าบัญชี) พร้อมลิงก์เปิดเพื่ออนุมัติ",
    href: "/request/clear-advance/admin/approvals",
    icon: <ClipboardCheck size={20} />,
  },
  {
    title: "รายงาน Control",
    desc: "รายงานสรุปการเคลียร์เงินทดรอง (AP-3-Control) พร้อมตัวกรอง",
    href: "/request/clear-advance/report",
    icon: <FileBarChart size={20} />,
  },
  {
    title: "รายงาน Detail",
    desc: "รายงานรายบรรทัด (Detail) พร้อมส่งออก Excel",
    href: "/request/clear-advance/report/detail",
    icon: <FileSpreadsheet size={20} />,
  },
];

function HubCardView({ card, href }: { card: HubCard; href: string }) {
  return (
    <HoverCard href={href} className="p-5 block">
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          {card.icon}
        </div>
      </div>
      <h3 className="text-[14px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
        {card.title}
      </h3>
      <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        {card.desc}
      </p>
    </HoverCard>
  );
}

function ClearAdvanceAdminContent() {
  const from = useSearchParams().get("from");
  const backHref = requestBackHref(from);

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Undo2}
        title="เคลียร์คืนเงินทดรองจ่าย (AP-3)"
        titleExtra={<FormEnvironmentChip formCode="AP-3" />}
        subtitle="รออนุมัติ ผู้อนุมัติ หมวดบัญชี G/L และรายงาน (AP-3)"
        backHref={backHref}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((card) => (
          <HubCardView key={card.href} card={card} href={withReturnTag(card.href, from)} />
        ))}
      </div>
    </PageContainer>
  );
}

export default function ClearAdvanceAdminHubPage() {
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
      <ClearAdvanceAdminContent />
    </Suspense>
  );
}
