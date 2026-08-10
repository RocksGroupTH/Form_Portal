"use client";

import { useSession } from "next-auth/react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { HoverCard } from "@/components/ui/HoverCard";
import { useAccountingAccess } from "@/features/accounting/hooks/useAccountingAccess";
import { Luggage, ClipboardCheck, FileSpreadsheet, Settings } from "lucide-react";

interface HubCard {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  accountOnly?: boolean;
}

const CARDS: HubCard[] = [
  {
    title: "คิวจองที่พัก/ตั๋วโดยสาร",
    desc: "รายการที่ผู้จัดการอนุมัติแล้ว รอ Admin กรอกข้อมูลการจอง (ห้องพัก/ตั๋ว/รถเช่า)",
    href: "/request/accounting/travel-booking/queue",
    icon: <ClipboardCheck size={20} />,
    accountOnly: true,
  },
  {
    title: "รายงาน",
    desc: "รายงานการจองที่พัก/ตั๋วโดยสารสำหรับฝ่ายบุคคล พร้อมตัวกรอง + ส่งออก Excel",
    href: "/request/accounting/travel-booking-report",
    icon: <FileSpreadsheet size={20} />,
    accountOnly: true,
  },
  {
    title: "ตั้งค่า",
    desc: "เหตุผลการเดินทาง · ที่พักค้างคืน · ยานพาหนะ · เช่ายานพาหนะ",
    href: "/request/accounting/travel-booking-settings",
    icon: <Settings size={20} />,
    adminOnly: true,
  },
];

function TravelBookingHubCard({ card }: { card: HubCard }) {
  return (
    <HoverCard href={card.href} className="p-5 block">
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          {card.icon}
        </div>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          AP-17
        </span>
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

/** AP-17 admin hub — its own management area (queue + report + settings), separate from AP-1. */
export default function TravelBookingHubPage() {
  const { data: session } = useSession();
  const { loading: accessLoading, canAccount } = useAccountingAccess();
  const role = session?.user?.role;
  const isAdmin = role === "IT Admin" || role === "System Admin";
  const cards = CARDS.filter((c) => {
    if (c.adminOnly && !isAdmin) return false;
    if (accessLoading) {
      if (c.accountOnly) return false;
      return true;
    }
    if (c.accountOnly && !canAccount) return false;
    return true;
  });

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Luggage}
        title="จองที่พัก/ตั๋วโดยสาร · บัญชี"
        subtitle="คิวจอง รายงาน และตั้งค่าการจองที่พัก/ตั๋วโดยสาร (AP-17)"
        backHref="/request"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <TravelBookingHubCard key={card.href} card={card} />
        ))}
      </div>
    </PageContainer>
  );
}
