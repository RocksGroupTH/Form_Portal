"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
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
  Settings,
} from "lucide-react";

interface HubCard {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
  /** The grant that reveals it — a menu key, or "settings" for the tab strip. */
  grant: string;
}
/**
 * Which of AP-2's and AP-3's menus and settings this viewer may open.
 *
 * A hub filter, **not a control**: every destination re-decides its own access
 * server-side (`requireAdvClrMenu` / `requireAdvClrSettingsTab`), so hiding a
 * card leaks nothing either way and showing one grants nothing. While the fetch
 * is in flight — and if it fails — nothing is shown but the cards an admin
 * always sees, because `isAdmin` comes back on the same response.
 */
function useAdvClrAccess() {
  const { data } = useSWR<{
    ok: boolean;
    data?: { isAdmin: boolean; canSettings: boolean; menus: Record<string, boolean> };
  }>("/api/request/advance/access", (url: string) => fetch(url).then((r) => r.json()));
  const d = data?.ok ? data.data : undefined;
  return {
    canSettings: !!d?.canSettings,
    menu: (key: string) => !!d?.menus?.[key],
  };
}


const CARDS: HubCard[] = [
  {
    title: "รออนุมัติ",
    desc: "คำขอเคลียร์เงินทดรองที่รออนุมัติ (ผู้จัดการ / บัญชี) พร้อมลิงก์เปิดเพื่ออนุมัติ",
    href: "/request/clear-advance/admin/approvals",
    icon: <ClipboardCheck size={20} />,
    grant: "clearQueue",
  },
  {
    title: "รายงาน Control",
    desc: "รายงานสรุปการเคลียร์เงินทดรอง (AP-3-Control) พร้อมตัวกรอง",
    href: "/request/clear-advance/report",
    icon: <FileBarChart size={20} />,
    grant: "clearReport",
  },
  {
    title: "รายงาน Detail",
    desc: "รายงานรายบรรทัด (Detail) พร้อมส่งออก Excel",
    href: "/request/clear-advance/report/detail",
    icon: <FileSpreadsheet size={20} />,
    grant: "clearReport",
  },
  // Last, with the cog every other form's hub uses (user, 2026-09-14). It was
  // first, under SlidersHorizontal — the one hub of the five where ตั้งค่า led
  // rather than closed, and the one with an icon of its own.
  {
    title: "ตั้งค่า",
    desc: "Interface ERP · หมวดบัญชี G/L · Fix G/L by BU or Branch · Location / BU · ผู้อนุมัติ",
    href: "/request/clear-advance/settings",
    icon: <Settings size={20} />,
    grant: "settings",
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
  const access = useAdvClrAccess();
  /* Filtering here HIDES links; it does not protect anything. Every
     destination re-decides its own access server-side. */
  const visible = CARDS.filter((c) =>
    c.grant === "settings" ? access.canSettings : access.menu(c.grant),
  );


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
        {visible.map((card) => (
          <HubCardView key={card.href} card={card} href={withReturnTag(card.href, from)} />
        ))}
      </div>
      {visible.length === 0 && (
        <p className="text-[13px] py-16 text-center m-0" style={{ color: "var(--text-muted)" }}>
          ไม่มีเมนูที่คุณเข้าถึงได้ — ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์
        </p>
      )}
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
