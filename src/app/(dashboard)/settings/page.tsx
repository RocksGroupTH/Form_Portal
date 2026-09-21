"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { HoverCard } from "@/components/ui/HoverCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { SETTINGS_CARDS } from "@/lib/constants";
import {
  Settings2,
  Server,
  Boxes,
  Layers,
  Shield,
  Map as MapIcon,
  KeyRound,
  Loader2,
  FlaskConical,
  ClipboardList,
} from "lucide-react";
import { isSystemAdminRole } from "@/lib/roles";
import { visibleSettingsCards } from "@/lib/settings-card-visibility";
import { useViewerUat } from "@/lib/hooks/useFormEnvironments";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  Server,
  Boxes,
  Layers,
  Shield,
  Map: MapIcon,
  KeyRound,
  FlaskConical,
  ClipboardList,
};

export default function SettingsHubPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const isAdmin =
    session?.user?.role === "IT Admin" || session?.user?.role === "System Admin";
  const isSystemAdmin = isSystemAdminRole(session?.user?.role);
  /**
   * `/api/form-environment`'s own answer, not the cookie: it re-checks an
   * active `UatTester` row, the same rule `viewerIsTesting()` applies inside
   * the resolver. One shared SWR key, and the navbar's PRO/UAT switch has
   * already asked for it, so this costs no extra request.
   *
   * Undefined while it loads, and undefined if the fetch failed — both read
   * as PRO here, so a `uatOnly` card appears once the payload lands rather
   * than flashing in and being taken away. That is the safe direction for
   * this rule and it hides a link, never data.
   */
  const isUatViewer = !!useViewerUat()?.uatMode;

  const visibleCards = visibleSettingsCards(SETTINGS_CARDS, {
    isSystemAdmin,
    isUatViewer,
  });

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

          return (
            <HoverCard key={item.id} href={item.href} className="p-5 block">
              {inner}
            </HoverCard>
          );
        })}
      </div>
    </PageContainer>
  );
}
