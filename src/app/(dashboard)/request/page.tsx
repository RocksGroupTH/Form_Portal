"use client";

import { useSearchParams } from "next/navigation";
import { HoverCard } from "@/components/ui/HoverCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { useBrand } from "@/components/BrandProvider";
import { getBrandById } from "@/lib/brand";
import { REQUEST_CARDS } from "@/lib/constants";
import { travelExpenseEntryHref } from "@/features/accounting/lib/navigation";
import { travelBookingEntryHref } from "@/features/travel-booking/lib/navigation";
import { useErpSandboxDevHost } from "@/features/accounting/hooks/useErpSandboxDevHost";
import {
  ClipboardList,
  Luggage,
  Package,
  Route,
  Settings,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  Package,
  ClipboardList,
  Route,
  Luggage,
};

function requestCardHref(item: (typeof REQUEST_CARDS)[number]): string {
  if (item.id === "travel-expense-form") return travelExpenseEntryHref("/request");
  if (item.id === "travel-booking-form") return travelBookingEntryHref("/request");
  return item.href;
}

function RequestHubCard({
  item,
  Icon,
}: {
  item: (typeof REQUEST_CARDS)[number];
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }> | undefined;
}) {
  const disabled = !!item.soon;
  const href = requestCardHref(item);

  const body = (
    <>
      <div className="flex items-start justify-between mb-3">
        <div
          className="relative w-10 h-10 rounded-lg flex items-center justify-center"
          style={{
            background: disabled
              ? "color-mix(in srgb, var(--text-faint) 22%, var(--bg-card-alt))"
              : "var(--nav-active-bg)",
          }}
        >
          {Icon && (
            <Icon
              size={20}
              style={{ color: disabled ? "var(--text-faint)" : "var(--nav-active-text)" }}
            />
          )}
          {item.manage && (
            <span
              className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-card)",
              }}
              aria-hidden
            >
              <Settings
                size={10}
                style={{ color: disabled ? "var(--text-faint)" : "var(--nav-active-text)" }}
              />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {item.badge && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: disabled
                  ? "color-mix(in srgb, var(--text-faint) 20%, transparent)"
                  : "var(--nav-active-bg)",
                color: disabled ? "var(--text-faint)" : "var(--nav-active-text)",
              }}
            >
              {item.badge}
            </span>
          )}
        </div>
      </div>
      <h3
        className="text-[14px] font-bold mb-1"
        style={{ color: disabled ? "var(--text-faint)" : "var(--text-heading)" }}
      >
        {item.label}
      </h3>
      <p className="text-[12px]" style={{ color: disabled ? "var(--text-faint)" : "var(--text-muted)" }}>
        {item.desc}
      </p>
    </>
  );


  if (disabled) {
    return (
      <div
        className="relative rounded-xl p-5 overflow-hidden cursor-not-allowed select-none"
        style={{
          background: "color-mix(in srgb, var(--bg-card-alt) 88%, var(--text-muted))",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "color-mix(in srgb, var(--border-card) 55%, var(--text-faint))",
          boxShadow: "none",
          filter: "grayscale(1)",
        }}
        aria-disabled
        title="Coming soon"
      >
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-[2]"
          aria-hidden
        >
          <span
            className="text-[52px] sm:text-[64px] font-black uppercase tracking-[0.25em] -rotate-[20deg]"
            style={{ color: "var(--text-muted)", opacity: 0.22 }}
          >
            Soon
          </span>
        </div>
        <div className="relative z-[1]">{body}</div>
      </div>
    );
  }

  return (
    <HoverCard href={href} className="p-5 block">
      {body}
    </HoverCard>
  );
}

export default function RequestHubPage() {
  const { brand } = useBrand();
  const currentBrand = getBrandById(brand);
  const isDevHost = useErpSandboxDevHost();

  /**
   * `?group=Settings` narrows the hub to one group's cards. Settings →
   * Accounting Admin lands here that way: that card promises the management
   * surfaces of AP-1 and AP-17, and the request forms above them are noise for
   * someone who came to work a queue.
   */
  const groupFilter = useSearchParams().get("group");
  const isGroupView = Boolean(groupFilter?.trim());
  const isAdminView = (groupFilter ?? "").trim().toLowerCase() === "settings";

  const visibleRequestCards = REQUEST_CARDS.filter(
    (item) =>
      (!item.devHostOnly || isDevHost) &&
      (!isGroupView ||
        (item.group ?? "General").toLowerCase() === (groupFilter ?? "").trim().toLowerCase()),
  );

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      {/* Header */}
      <PageHeaderBar
        icon={ClipboardList}
        title={isAdminView ? "Accounting Admin" : "Request"}
        subtitle={
          isAdminView
            ? "คิวอนุมัติ รายงาน และตั้งค่าของ AP-1 / AP-17"
            : "Submit master-data requests — items, vendors, price changes"
        }
        backHref={isAdminView ? "/settings" : "/"}
        backLabel={isAdminView ? "Back to settings" : "Back to home"}
        right={
          currentBrand && (
            <div
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <img src={currentBrand.logo} alt="" width={20} height={20} className="rounded" />
              <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>
                {currentBrand.name}
              </span>
            </div>
          )
        }
      />

      {/* Section label */}
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
          {isAdminView ? "การจัดการ" : "Available requests"}
        </h2>
        <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
          {isAdminView
            ? "เลือกฟอร์มเพื่อเข้าคิวอนุมัติ รายงาน และตั้งค่า"
            : "Choose a category to start a request"}
        </span>
      </div>

      {visibleRequestCards.length > 0 ? (
        <>
      {/* Request type cards — grouped by category */}
      {(() => {
        // Build ordered list of unique groups, preserving insertion order
        const groupOrder: string[] = [];
        const groupMap: Record<string, typeof REQUEST_CARDS> = {};
        for (const item of visibleRequestCards) {
          const g = item.group ?? "General";
          if (!groupMap[g]) {
            groupOrder.push(g);
            groupMap[g] = [];
          }
          groupMap[g].push(item);
        }
        return groupOrder.map((groupName) => {
          const cards = groupMap[groupName];
          const groupThLabel = cards[0].groupTh ? ` · ${cards[0].groupTh}` : "";
          return (
            <div key={groupName} className="mb-6">
              {/* Group header — pointless when the whole page is one group */}
              {!isGroupView && (
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {groupName}
                  </span>
                  {groupThLabel && (
                    <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                      {groupThLabel}
                    </span>
                  )}
                  <div
                    className="flex-1 h-px"
                    style={{ background: "var(--border-card)" }}
                  />
                </div>
              )}

              {/* Cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cards.map((item) => {
                  const Icon = ICON_MAP[item.icon];
                  return (
                    <RequestHubCard key={item.id} item={item} Icon={Icon} />
                  );
                })}
              </div>
            </div>
          );
        });
      })()}
        </>
      ) : (
        /* The management cards are devHostOnly, so this view is empty off
           localhost. Say so rather than rendering a header over nothing. */
        <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
          {isAdminView
            ? "หน้าจัดการของ AP-1 / AP-17 เปิดได้เฉพาะตอนรัน dev ที่ localhost:3020"
            : "ยังไม่มีคำขอที่เปิดให้ใช้งาน"}
        </p>
      )}

    </PageContainer>
  );
}
