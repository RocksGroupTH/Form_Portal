"use client";

import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { requestBackHref, withReturnTag } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { HoverCard } from "@/components/ui/HoverCard";
import { useBookingAccess } from "@/features/travel-booking/hooks/useBookingAccess";
import { AlertCircle, Luggage, ClipboardCheck, FileSpreadsheet, Settings } from "lucide-react";

interface HubCard {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  accountOnly?: boolean;
  /**
   * The AccBookingApproverTab menu key that ALSO opens this card, on top of
   * roster membership — see the filter below for why it is "also" and not
   * "instead".
   */
  menu?: "bookingQueue" | "accountApproval";
}

const CARDS: HubCard[] = [
  {
    title: "คิวจองที่พัก/ตั๋วโดยสาร",
    desc: "รายการที่ผู้จัดการอนุมัติแล้ว รอ Admin กรอกข้อมูลการจอง (ห้องพัก/ตั๋ว/รถเช่า)",
    href: "/request/accounting/travel-booking/queue",
    icon: <ClipboardCheck size={20} />,
    accountOnly: true,
    menu: "bookingQueue",
  },
  {
    title: "อนุมัติจองที่พัก/ตั๋วโดยสาร (บัญชี)",
    desc: "รายการที่ Admin จองเสร็จแล้ว รอบัญชีเลือกเดือนจ่ายแล้วอนุมัติปิดงาน",
    href: "/request/accounting/travel-booking/approvals",
    icon: <ClipboardCheck size={20} />,
    accountOnly: true,
    menu: "accountApproval",
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
    desc: "เหตุผลการเดินทาง · ที่พัก · การเดินทาง · เช่ายานพาหนะ · สิทธิ์เข้าถึง",
    href: "/request/accounting/travel-booking-settings",
    icon: <Settings size={20} />,
    adminOnly: true,
  },
];

function TravelBookingHubCard({ card, href }: { card: HubCard; href: string }) {
  return (
    <HoverCard href={href} className="p-5 block">
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
  const {
    loading: accessLoading,
    canAccount,
    canSettings,
    bookingQueue,
    accountApproval,
    error: accessError,
  } = useBookingAccess();
  const menuGrants = { bookingQueue, accountApproval };
  const role = session?.user?.role;
  const isAdmin = role === "IT Admin" || role === "System Admin";
  const cards = CARDS.filter((c) => {
    // `adminOnly` now means "admin, or holding at least one settings-tab
    // grant" — matching AP-1's hub. Without `canSettings` a granted non-admin
    // could open the settings page and pass its routes, but had no menu path
    // to it: the grant worked and was unreachable.
    if (c.adminOnly && !isAdmin && !canSettings) return false;
    if (accessLoading) {
      if (c.accountOnly) return false;
      return true;
    }
    // Roster membership OR the menu grant — deliberately "or", not the
    // grant alone. Measured 2026-08-27: AccBookingApproverTab holds **zero**
    // rows while AccBookingApprover holds two active ones, and one of those
    // two is a Staff-role Accounting Manager. Gating on the grant alone would
    // have taken the booking queue away from exactly the person the queue is
    // for, the day this shipped. The grant therefore *adds* reach — it opens a
    // menu to somebody who is not on the roster — rather than being a second
    // thing a roster member must also be given.
    //
    // Nothing is leaked by showing a card: the pages behind both queues
    // authorize with canAccessBookingArea server-side regardless.
    if (c.accountOnly && !canAccount && !(c.menu && menuGrants[c.menu])) return false;
    return true;
  });
  const from = useSearchParams().get("from");
  const backHref = requestBackHref(from);

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Luggage}
        title="จองที่พัก/ตั๋วโดยสาร · บัญชี"
        titleExtra={<FormEnvironmentChip formCode="AP-17" />}
        subtitle="คิวจอง รายงาน และตั้งค่าการจองที่พัก/ตั๋วโดยสาร (AP-17)"
        backHref={backHref}
      />

      {/* An unreadable /access check hides the same cards a real refusal hides.
          Say which one happened, rather than letting the menu imply the viewer is
          off the roster. */}
      {accessError ? (
        <div
          className="rounded-2xl p-4 mb-4 flex items-start gap-2.5"
          style={{ background: "var(--bg-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
        >
          <AlertCircle size={16} style={{ color: "var(--text-info-yellow)", marginTop: 2 }} className="shrink-0" />
          <p className="text-[13px] m-0" style={{ color: "var(--text-info-yellow)" }}>
            ตรวจสอบสิทธิ์ไม่สำเร็จ — เมนูที่ต้องใช้สิทธิ์จึงยังไม่แสดง กรุณาลองโหลดหน้านี้ใหม่อีกครั้ง
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <TravelBookingHubCard key={card.href} card={card} href={withReturnTag(card.href, from)} />
        ))}
      </div>
    </PageContainer>
  );
}
