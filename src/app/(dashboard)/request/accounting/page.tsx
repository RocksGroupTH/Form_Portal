"use client";

import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { requestBackHref, withReturnTag } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { HoverCard } from "@/components/ui/HoverCard";
import { useAccountingAccess } from "@/features/accounting/hooks/useAccountingAccess";
import {
  Receipt,
  ClipboardCheck,
  FileBarChart,
  Settings,
} from "lucide-react";
interface HubCard {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  approverOnly?: boolean;
  accountOnly?: boolean;
  badge?: string;
}

const CARDS: HubCard[] = [
  {
    title: "อนุมัติ (บัญชี)",
    desc: "คิวรออนุมัติ · กำหนดวันจ่าย · เตรียมข้อมูลส่ง Interface ERP",
    href: "/request/accounting/approvals",
    icon: <ClipboardCheck size={20} />,
    approverOnly: true,
  },
  {
    title: "รายงาน",
    desc: "รายงานการเบิกค่าเดินทาง พร้อมตัวกรอง + ส่งออก Excel",
    href: "/request/accounting/report",
    icon: <FileBarChart size={20} />,
    accountOnly: true,
  },
  {
    title: "ตั้งค่า",
    desc: "ผู้อนุมัติบัญชี · พาหนะ & เรท · แบรนด์ · G/L & Bank · Interface ERP",
    href: "/request/accounting/settings",
    icon: <Settings size={20} />,
    adminOnly: true,
  },
];

function AccountingHubCard({ card, href }: { card: HubCard; href: string }) {
  return (
    <HoverCard href={href} className="p-5 block">
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          {card.icon}
        </div>
        {card.badge && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            {card.badge}
          </span>
        )}
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

export default function AccountingHubPage() {
  const { data: session } = useSession();
  const from = useSearchParams().get("from");
  const backHref = requestBackHref(from);
  const { loading: accessLoading, isApprover, canAccount } = useAccountingAccess();
  const role = session?.user?.role;
  const isAdmin = role === "IT Admin" || role === "System Admin";
  const cards = CARDS.filter((c) => {
    if (c.adminOnly && !isAdmin) return false;
    if (accessLoading) {
      if (c.approverOnly || c.accountOnly) return false;
      return true;
    }
    if (c.approverOnly && !isApprover) return false;
    if (c.accountOnly && !canAccount) return false;
    return true;
  });

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      {/* Header */}
      <PageHeaderBar
        icon={Receipt}
        title="Accounting · บัญชี"
        subtitle="อนุมัติ รายงาน และตั้งค่าเบิกค่าเดินทาง (AP-1)"
        backHref={backHref}
      />

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <AccountingHubCard key={card.href} card={card} href={withReturnTag(card.href, from)} />
        ))}
      </div>
    </PageContainer>
  );
}
