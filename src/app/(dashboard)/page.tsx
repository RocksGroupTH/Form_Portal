"use client";

import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { HoverCard } from "@/components/ui/HoverCard";
import { ADMIN_HOME_CARDS, HOME_CARDS } from "@/lib/constants";
import { useRole } from "@/lib/hooks/useRole";
import { useBrand } from "@/components/BrandProvider";
import { getBrandFromSearchParams, replaceSearchParams, setBrandInSearchParams } from "@/lib/brand-url";
import {
  FileText,
  BarChart3,
  MapPin,
  Package,
  ClipboardList,
  Settings2,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  FileText,
  BarChart3,
  MapPin,
  Package,
  ClipboardList,
  Settings2,
};

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const { canAdmin } = useRole();
  const sp = useSearchParams();
  const { brand } = useBrand();
  const user = session?.user;

  const { data: meData } = useSWR<{ ok: boolean; data?: { isAdmin?: boolean } }>(
    status === "authenticated" ? "/api/me" : null,
    fetcher,
  );

  const isAdmin = status === "authenticated" && (meData?.data?.isAdmin ?? canAdmin);
  const hasIntel = status === "authenticated" && (user?.hasIntel ?? false);
  const visibleHomeCards = HOME_CARDS.filter((card) => !card.requiresIntel || hasIntel);
  const cards = isAdmin ? [...visibleHomeCards, ...ADMIN_HOME_CARDS] : visibleHomeCards;

  const hrefWithBrand = (href: string) => {
    const current = new URLSearchParams(sp.toString());
    const urlBrand = getBrandFromSearchParams(current) ?? brand;
    if (!urlBrand) return href;
    const next = setBrandInSearchParams(current, urlBrand);
    return replaceSearchParams(href, next);
  };

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
          {user ? `Welcome, ${user.nickname || user.name}` : "Welcome"}
        </h1>
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          Rocks Fast — Internal portal for Rocks Group
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((item) => {
          const Icon = ICON_MAP[item.icon];
          return (
            <HoverCard key={item.id} href={hrefWithBrand(item.href)} className="p-5 block">
              <div className="flex items-start justify-between mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: "var(--nav-active-bg)" }}
                >
                  {Icon && <Icon size={20} className="text-[var(--nav-active-text)]" />}
                </div>
              </div>
              <h2 className="text-[14px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
                {item.label}
              </h2>
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                {item.desc}
              </p>
            </HoverCard>
          );
        })}
      </div>
    </PageContainer>
  );
}
