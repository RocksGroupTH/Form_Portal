"use client";

import { useSearchParams } from "next/navigation";
import { requestBackHref, withReturnTag } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { HoverCard } from "@/components/ui/HoverCard";
import { Wallet, ClipboardCheck, FileBarChart, Settings } from "lucide-react";

interface HubCard {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
}

const CARDS: HubCard[] = [
  {
    title: "รออนุมัติ",
    desc: "คิวคำขอที่รอคุณอนุมัติ ตามระดับของคุณ (Head Accounting / ผู้บริหาร / Accounting Officer)",
    href: "/request/advance/inbox",
    icon: <ClipboardCheck size={20} />,
  },
  {
    title: "รายงาน",
    desc: "รายงานคำขอเบิกเงินทดรองจ่ายทั้งหมด (คอลัมน์ตาม AP-2-Control)",
    href: "/request/advance/report",
    icon: <FileBarChart size={20} />,
  },
  {
    title: "ตั้งค่า",
    desc: "ผู้อนุมัติ · ขั้นอนุมัติตามจำนวนเงิน (Approval Matrix) · ธนาคาร (Master)",
    href: "/request/advance/settings",
    icon: <Settings size={20} />,
  },
];

function HubCardView({ card, href }: { card: HubCard; href: string }) {
  return (
    <HoverCard href={href} className="p-5 block">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
          {card.icon}
        </div>
      </div>
      <h3 className="text-[14px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>{card.title}</h3>
      <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{card.desc}</p>
    </HoverCard>
  );
}

export default function AdvanceHubPage() {
  const from = useSearchParams().get("from");
  const backHref = requestBackHref(from);

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Wallet}
        title="เบิกเงินทดรองจ่าย · AP-2"
        titleExtra={<FormEnvironmentChip formCode="AP-2" />}
        subtitle="อนุมัติ คำขอ และตั้งค่า (AP-2)"
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
