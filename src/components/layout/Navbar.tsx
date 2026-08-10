"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTheme } from "@/components/ThemeProvider";
import { NAV } from "@/lib/constants";
import { Avatar } from "@/components/ui/Avatar";
import { BrandSwitcher } from "@/components/BrandSwitcher";
import { useBrand } from "@/components/BrandProvider";
import { UserProfileModal } from "@/components/layout/UserProfileModal";
import { ErpEnvironmentNavBadge } from "@/components/layout/ErpEnvironmentNavBadge";
import { useUserPhoto } from "@/lib/hooks/useUserPhoto";
import { getBrandFromSearchParams, replaceSearchParams, setBrandInSearchParams } from "@/lib/brand-url";
import { TRAVEL_FROM_PARAM, resolveTravelReturnPath } from "@/features/accounting/lib/navigation";
import {
  Sun, Moon, Home, FileText, BarChart3, MapPin, ClipboardList, ClipboardCheck, Send,
} from "lucide-react";
import { useSearchParams } from "next/navigation";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  FileText, BarChart3, MapPin, ClipboardList, ClipboardCheck, Send,
};

function NavIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const Icon = ICON_MAP[icon];
  return Icon ? <Icon size={size} /> : null;
}

export function Navbar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const { brand } = useBrand();
  const { data: session, status } = useSession();
  const { theme, toggleTheme } = useTheme();
  const user = session?.user;
  const hasIntel = status === "authenticated" && (session?.user?.hasIntel ?? false);
  const visibleNav = NAV.filter((n) => !n.requiresIntel || hasIntel);
  const displayPhoto = useUserPhoto();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMobile, setProfileMobile] = useState(false);
  const [iconOnlyNav, setIconOnlyNav] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const measure = measureRef.current;
    if (!header || !left || !right || !measure) return;

    const update = () => {
      const gap = 24;
      const available = header.clientWidth - left.offsetWidth - right.offsetWidth - gap;
      setIconOnlyNav(measure.offsetWidth > available);
    };

    const ro = new ResizeObserver(update);
    ro.observe(header);
    ro.observe(left);
    ro.observe(right);
    ro.observe(measure);
    update();
    return () => ro.disconnect();
  }, []);

  const openProfile = (mobile: boolean) => {
    setProfileMobile(mobile);
    setProfileOpen(true);
  };

  /** Which nav section owns the current view (honours ?from= on travel-expense routes). */
  const navContextPath = pathname.startsWith("/request/travel-expense")
    ? resolveTravelReturnPath(sp.get(TRAVEL_FROM_PARAM), "/request")
    : pathname;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return navContextPath === href || navContextPath.startsWith(`${href}/`);
  };

  const hrefWithBrand = (href: string) => {
    const current = new URLSearchParams(sp.toString());
    const urlBrand = getBrandFromSearchParams(current) ?? brand;
    if (!urlBrand) return href;

    const next = setBrandInSearchParams(current, urlBrand);
    return replaceSearchParams(href, next);
  };

  return (
    <>
      {/* ── Desktop Top Bar ── */}
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-30 hidden md:flex items-center justify-between px-4 h-12 backdrop-blur-md"
        style={{
          background: "var(--bg-topbar)",
          borderBottom: "1px solid var(--border-main)",
        }}
      >
        {/* Left: Logo */}
        <div ref={leftRef} className="flex items-center gap-3 shrink-0">
          <Link href={hrefWithBrand("/")} className="flex items-center gap-2 no-underline">
            <img src="/brandlogo/rocks.png" alt="Rocks Fast" width={24} height={24} />
            <span className="text-[14px] font-bold whitespace-nowrap" style={{ color: "var(--text-heading)" }}>
              Rocks Fast
            </span>
          </Link>
        </div>

        {/* Center: Nav Links */}
        <nav className="flex items-center gap-1 flex-nowrap min-w-0">
          {visibleNav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.id}
                href={hrefWithBrand(item.href)}
                title={iconOnlyNav ? item.label : undefined}
                aria-label={iconOnlyNav ? item.label : undefined}
                className={`flex items-center rounded-lg text-[13px] font-medium no-underline transition-colors shrink-0 ${
                  iconOnlyNav ? "justify-center p-2" : "gap-1.5 px-3 py-1.5"
                }`}
                style={{
                  background: active ? "var(--nav-active-bg)" : "transparent",
                  color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                }}
              >
                <NavIcon icon={item.icon} size={iconOnlyNav ? 17 : 15} />
                {!iconOnlyNav && <span className="whitespace-nowrap">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Off-screen measurer — full labels to detect when icons-only is needed */}
        <div
          ref={measureRef}
          className="absolute flex items-center gap-1 invisible pointer-events-none"
          style={{ left: -9999, top: 0 }}
          aria-hidden="true"
        >
          {visibleNav.map((item) => (
            <span
              key={item.id}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium whitespace-nowrap"
            >
              <NavIcon icon={item.icon} size={15} />
              {item.label}
            </span>
          ))}
        </div>

        {/* Right: ERP env + Brand + Theme + User */}
        <div ref={rightRef} className="flex items-center gap-2 shrink-0">
          <ErpEnvironmentNavBadge />
          <BrandSwitcher />
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "transparent", color: "var(--text-secondary)" }}
            aria-label={`Switch to ${theme === "light" ? "gold" : "light"} mode`}
          >
            {theme === "gold" ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {user && (
            <button
              type="button"
              onClick={() => openProfile(false)}
              className="cursor-pointer border-none bg-transparent p-0 rounded-full"
              aria-label="My profile"
            >
              <Avatar name={user.nickname || user.name || ""} color={user.color} size={30} photo={displayPhoto} />
            </button>
          )}
        </div>
      </header>

      {/* ── Mobile Top Bar ── */}
      <header
        className="fixed top-0 left-0 right-0 z-30 flex md:hidden items-center justify-between px-3 h-14"
        style={{
          background: "var(--bg-topbar)",
          borderBottom: "1px solid var(--border-main)",
        }}
      >
        {/* Left: User avatar */}
        {user && (
          <button
            type="button"
            onClick={() => openProfile(true)}
            className="cursor-pointer border-none bg-transparent p-0 rounded-full"
            aria-label="My profile"
          >
            <Avatar name={user.nickname || user.name || ""} color={user.color} size={28} photo={displayPhoto} />
          </button>
        )}

        {/* Center: Logo */}
        <Link href={hrefWithBrand("/")} className="flex items-center gap-1.5 no-underline">
          <img src="/brandlogo/rocks.png" alt="Rocks Fast" width={22} height={22} />
          <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
            Rocks Fast
          </span>
        </Link>

        {/* Right: ERP env + Brand + Theme toggle */}
        <div className="flex items-center gap-1.5">
          <ErpEnvironmentNavBadge compact />
          <BrandSwitcher compact />
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "transparent", color: "var(--text-secondary)" }}
            aria-label={`Switch to ${theme === "light" ? "gold" : "light"} mode`}
          >
            {theme === "gold" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* ── Mobile Bottom Tab Bar ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 flex md:hidden items-stretch"
        style={{
          minHeight: 72,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          background: "var(--bg-card)",
          borderTop: "1px solid var(--border-main)",
        }}
      >
        {/* Home tab */}
        <Link
          href={hrefWithBrand("/")}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 no-underline py-1.5 px-0.5"
          style={{ color: isActive("/") && pathname === "/" ? "var(--nav-active-text)" : "var(--text-muted)" }}
        >
          <Home size={20} className="shrink-0" />
          <span className="text-[9px] font-medium text-center leading-[1.15] w-full whitespace-normal">
            Home
          </span>
        </Link>

        {/* Feature tabs */}
        {visibleNav.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.id}
              href={hrefWithBrand(item.href)}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 no-underline py-1.5 px-0.5"
              style={{ color: active ? "var(--nav-active-text)" : "var(--text-muted)" }}
            >
              <NavIcon icon={item.icon} size={20} />
              <span className="text-[9px] font-medium text-center leading-[1.15] w-full whitespace-normal">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <UserProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        mobile={profileMobile}
      />
    </>
  );
}
