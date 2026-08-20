"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { FileBarChart, PackageCheck, Settings2 } from "lucide-react";
import { HoverCard } from "@/components/ui/HoverCard";

/**
 * The menu across AP-11's three back-office pages, as cards.
 *
 * AP-17 solves this with a hub: `/request/accounting/travel-booking` is a page
 * of three cards, and its queue lives one level down at `/queue`. AP-11's card
 * on the Request hub goes straight to the queue instead, so `reward-report` and
 * `reward-settings` had nothing pointing at them anywhere in the app — they
 * existed and were reachable only by typing the URL. This puts the same three
 * cards on each of the pages rather than moving any of them, so every existing
 * link and bookmark still lands where it did, and there is no hub page standing
 * between the Request hub and the queue.
 *
 * The card the viewer is already on renders as a plain panel, not a link: a
 * `HoverCard` that lifts and then navigates to where you are is an affordance
 * that lies. It keeps the accent border so the set still reads as a menu with a
 * current position.
 *
 * `from` and `brand` are carried across, and nothing else. `from=admin` is the
 * return tag the Request hub sets (`request-hub-nav.ts`) and every hop has to
 * pass it on or Back forgets which hub it came from; `brand` keeps BrandGate's
 * selection while moving between pages. Page state — report filters, queue
 * paging — is deliberately dropped: it means something different on each page.
 */
const CARDS = [
  {
    href: "/request/accounting/reward",
    label: "คิวจัดของรางวัล",
    desc: "อนุมัติ → จัดของ → จ่ายของ",
    Icon: PackageCheck,
  },
  {
    href: "/request/accounting/reward-report",
    label: "รายงาน",
    desc: "คำขอทั้งหมดพร้อมตัวกรอง + ส่งออก Excel",
    Icon: FileBarChart,
  },
  {
    href: "/request/accounting/reward-settings",
    label: "ตั้งค่าของรางวัล",
    desc: "คลังของรางวัล · บริษัท · ทีม Assist AP",
    Icon: Settings2,
  },
];

const CARD_PADDING = "p-4 block";

function CardBody({
  Icon,
  label,
  desc,
  current,
}: {
  Icon: typeof PackageCheck;
  label: string;
  desc: string;
  current: boolean;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          <Icon size={18} />
        </div>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{
            background: "var(--nav-active-bg)",
            color: "var(--nav-active-text)",
            visibility: current ? "visible" : "hidden",
          }}
        >
          หน้านี้
        </span>
      </div>
      <h3 className="text-[13.5px] font-bold mb-0.5" style={{ color: "var(--text-heading)" }}>
        {label}
      </h3>
      <p className="text-[11.5px] m-0" style={{ color: "var(--text-muted)" }}>
        {desc}
      </p>
    </>
  );
}

export function RewardAdminNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const carried = new URLSearchParams();
  const from = searchParams.get("from");
  const brand = searchParams.get("brand");
  if (from) carried.set("from", from);
  if (brand) carried.set("brand", brand);
  const qs = carried.toString();

  return (
    <nav
      aria-label="เมนู AP-11 หลังบ้าน"
      className={`grid grid-cols-1 sm:grid-cols-3 gap-3 ${className}`}
    >
      {CARDS.map(({ href, label, desc, Icon }) => {
        // Exact match: `/request/accounting/reward` is a prefix of both
        // hyphenated siblings, so startsWith would mark all three as current.
        const current = pathname === href;
        if (current) {
          return (
            <div
              key={href}
              aria-current="page"
              className={`rounded-xl ${CARD_PADDING}`}
              style={{
                background: "var(--bg-card)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "var(--nav-active-text)",
                boxShadow: "0 0 0 3px var(--nav-active-bg), var(--shadow-sm)",
              }}
            >
              <CardBody Icon={Icon} label={label} desc={desc} current />
            </div>
          );
        }
        return (
          <HoverCard key={href} href={qs ? `${href}?${qs}` : href} className={CARD_PADDING}>
            <CardBody Icon={Icon} label={label} desc={desc} current={false} />
          </HoverCard>
        );
      })}
    </nav>
  );
}
