"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { HoverCard } from "@/components/ui/HoverCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Dialog } from "@/components/ui/Dialog";
import { MapProviderSettings } from "@/components/settings/MapProviderSettings";
import { SETTINGS_CARDS } from "@/lib/constants";
import {
  Settings2,
  Server,
  Boxes,
  Layers,
  Shield,
  Map as MapIcon,
  Loader2,
  FlaskConical,
  ClipboardList,
} from "lucide-react";
import { isSystemAdminRole } from "@/lib/roles";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  Server,
  Boxes,
  Layers,
  Shield,
  Map: MapIcon,
  FlaskConical,
  ClipboardList,
};

export default function SettingsHubPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mapsOpen, setMapsOpen] = useState(false);
  const isAdmin =
    session?.user?.role === "IT Admin" || session?.user?.role === "System Admin";
  const isSystemAdmin = isSystemAdminRole(session?.user?.role);

  const visibleCards = SETTINGS_CARDS.filter(
    (item) => !item.systemAdminOnly || isSystemAdmin,
  );

  useEffect(() => {
    if (status === "authenticated" && !isAdmin) router.replace("/");
  }, [status, isAdmin, router]);

  if (status === "loading" || (status === "authenticated" && !isAdmin)) {
    return (
      <PageContainer className="py-12 flex justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings2}
        title="Settings"
        subtitle="Database connections, permissions, and system configuration"
        backHref="/"
        backLabel="Back to home"
      />

      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
          Configuration
        </h2>
        <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
          IT Admin and System Admin only
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleCards.map((item) => {
          const Icon = ICON_MAP[item.icon];
          const inner = (
            <>
              <div className="flex items-start justify-between mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: "var(--nav-active-bg)" }}
                >
                  {Icon && <Icon size={20} style={{ color: "var(--nav-active-text)" }} />}
                </div>
              </div>
              <h3 className="text-[14px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
                {item.label}
              </h3>
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                {item.desc}
              </p>
            </>
          );

          if (item.id === "maps") {
            return (
              <HoverCard key={item.id} onClick={() => setMapsOpen(true)} className="p-5">
                {inner}
              </HoverCard>
            );
          }

          return (
            <HoverCard key={item.id} href={item.href} className="p-5 block">
              {inner}
            </HoverCard>
          );
        })}
      </div>

      <Dialog
        open={mapsOpen}
        onOpenChange={setMapsOpen}
        title="Maps & Routing"
        contentClassName="max-w-2xl"
      >
        <MapProviderSettings />
      </Dialog>
    </PageContainer>
  );
}
