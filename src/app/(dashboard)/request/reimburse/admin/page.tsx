"use client";

import { useSearchParams } from "next/navigation";
import { requestBackHref, withReturnTag } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { HoverCard } from "@/components/ui/HoverCard";
import { Receipt, ClipboardCheck, Settings } from "lucide-react";

interface HubCard {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
}

const CARDS: HubCard[] = [
  {
    title: "คิวอนุมัติ (บัญชี)",
    desc: "รายการที่ผู้จัดการอนุมัติแล้ว รอบัญชีเลือกวันที่จ่ายและส่งต่อ",
    href: "/request/reimburse/approvals",
    icon: <ClipboardCheck size={20} />,
  },
  {
    title: "ตั้งค่า",
    desc: "แบรนด์ที่เบิกได้ · ระเบียบการจ่าย · Interface ERP · สิทธิ์เข้าถึง (รวมผู้อนุมัติฝ่ายบัญชี)",
    href: "/request/reimburse/settings",
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

/**
 * AP-4's hub — the one door `/request` points at for this form, replacing the
 * two separate management cards (`reimburse-settings` and
 * `reimburse-approvals`) that used to sit side by side there. AP-2's
 * `/request/advance/admin` is the model this copies, shape for shape; AP-3's
 * `/request/clear-advance/admin` did the same thing a second time, and AP-17's
 * `/request/accounting/travel-booking` a third — this is AP-4 catching up to
 * a convention every other multi-surface form already follows.
 *
 * Two cards, not four, since 2026-09-10: this hub used to also link straight
 * to the fill form and to a standalone Interface ERP card. A survey of all
 * five form hubs (AP-1, AP-2, AP-3, AP-4, AP-17) found AP-4 was the only one
 * doing either — AP-2 and AP-3 both put ERP behind a tab, exactly where the
 * surviving queue card already puts it
 * (`/request/reimburse/approvals?tab=interface`), so the standalone card was a
 * second, redundant door to the same tab. The form stays reachable from
 * `reimburse-form` on `/request` and from Home; nothing else pointed at it
 * once this card was gone, so removing it did not strand the form.
 *
 * Every card here is a link, not a gate: access to what each one opens is
 * re-decided server-side at the destination (`requireReimburseSettingsTab` /
 * `requireRole` for settings, `decideReimburseMenuAccess` for the queue), so
 * this page shows both cards unconditionally rather than hiding one behind a
 * client-side read of `useReimburseAccess()` — the same reason AP-2's and
 * AP-3's hubs do not gate their own cards either.
 */
export default function ReimburseAdminHubPage() {
  const from = useSearchParams().get("from");
  const backHref = requestBackHref(from);

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Receipt}
        title="ขอเบิกเงินคืนพนักงาน · AP-4"
        titleExtra={<FormEnvironmentChip formCode="AP-4" />}
        subtitle="คิวอนุมัติ (บัญชี) และตั้งค่า (AP-4)"
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
