"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { format, formatDistanceToNow } from "date-fns";
import { useBrand } from "@/components/BrandProvider";
import { PageContainer } from "@/components/layout/PageContainer";
import { HoverCard } from "@/components/ui/HoverCard";
import { BarChart3, TrendingUp, Building2, Coffee, Clock, LayoutGrid, Settings2, Wallet, Info, ChevronDown, AlertTriangle } from "lucide-react";
import { X } from "lucide-react";
import { CUSTOM_DASHBOARDS } from "@/features/intelligence/constants";
import { BRANDS } from "@/lib/brand";
import { useRole } from "@/lib/hooks/useRole";
import { BackButton } from "@/components/layout/BackButton";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  BarChart3, TrendingUp, Building2, Coffee, Clock, LayoutGrid, Settings2, Wallet,
};

interface DataSource {
  name: string;
  logo: string;
  color: string;
  description: string;
  enabled: boolean;
}

const DATA_SOURCES: DataSource[] = [
  { name: "Foodstory UNO", logo: "/brandlogo/foodstory.png", color: "#dc2626", description: "UNO POS transactions", enabled: true },
  { name: "Foodstory KSI", logo: "/brandlogo/foodstory.png", color: "#5A4118", description: "KSI POS transactions", enabled: true },
  { name: "Business Central", logo: "/brandlogo/d365-business-central.png", color: "#2563eb", description: "Recipe, inventory, financial", enabled: false },
  { name: "Location Master", logo: "", color: "#16a34a", description: "Store locations, branches, regions", enabled: true },
  { name: "Manual File", logo: "", color: "#f59e0b", description: "Manual data, flat files", enabled: false },
];

const REPORTS = [
  { id: "sales-monitor", icon: "📈", label: "Sales Monitor", desc: "Daily sales by branch, channel, order type" },
  { id: "sales-item", icon: "☕", label: "Sales by Item", desc: "Revenue by menu item, category, branch" },
  { id: "transaction", icon: "🧾", label: "Transaction", desc: "Bill-level detail — receipt, items, payment" },
  { id: "tender", icon: "💳", label: "Tender", desc: "Payment breakdown — QR, Cash, Credit Card" },
  { id: "promotion", icon: "🎁", label: "Voucher", desc: "Voucher usage, discount amounts, promo codes" },
  { id: "void", icon: "🚫", label: "Void", desc: "Voided items — who, reason, amount lost" },
  { id: "vat", icon: "🧮", label: "VAT", desc: "Tax summary — net sales, VAT amount" },
  { id: "edc", icon: "📟", label: "EDC", desc: "Credit card / EDC settlement" },
  { id: "waste", icon: "🗑️", label: "Waste", desc: "Barista quota, marketing & normal waste" },
  { id: "stock-movement", icon: "📦", label: "Stock Movement", desc: "Stock in/out, transfers, adjustments", soon: true, source: "ERP & Web Inventory" },
  { id: "recipe", icon: "📝", label: "Recipe (BOM)", desc: "Ingredients, portions, cost per item", soon: true, source: "ERP" },
  { id: "damage", icon: "💔", label: "Damage", desc: "Damaged goods, write-offs, loss tracking", soon: true, source: "Web Inventory" },
];

// Temporary: hide menus not launched yet (hub workspace).
const SHOW_REMAINING_DASHBOARDS = true;
const SHOW_REPORTS = true;

export default function IntelligencePage() {
  return <Suspense><IntelligenceContent /></Suspense>;
}

function IntelligenceContent() {
  const searchParams = useSearchParams();
  const brandFromUrl = searchParams.get("brand");
  const { brand: globalBrand, setBrand: setGlobalBrand } = useBrand();
  const [inWorkspace, setInWorkspace] = useState(false);
  const [showArch, setShowArch] = useState(false);
  const urlBrandSynced = useRef(false);
  const { isITAdmin, isSystemAdmin } = useRole();
  const canConfigBrands = isITAdmin || isSystemAdmin;
  const { data: freshnessData } = useSWR<{ ok: boolean; data: Record<string, { lastDate: string | null; rowCount: number | null }> }>(
    "/api/intelligence/data-freshness", fetcher,
  );
  const { data: permData } = useSWR<{
    ok: boolean;
    data: { brands: string[]; isAdmin: boolean; dashboardReady?: Record<string, boolean> };
  }>("/api/intelligence/permissions", fetcher);

  const dashboardReady = permData?.data?.dashboardReady ?? {};
  const readyBrandIds = BRANDS.filter((b) => b.enabled && dashboardReady[b.id]).map((b) => b.id);
  const { data: branchCountData } = useSWR<Record<string, number>>(
    readyBrandIds.length > 0 ? `branch-counts:${readyBrandIds.join(",")}` : null,
    async () => {
      const counts: Record<string, number> = {};
      await Promise.all(
        readyBrandIds.map(async (id) => {
          try {
            const res = await fetch(`/api/intelligence/branches?brand=${id}`);
            const json = await res.json();
            counts[id] = json.ok ? json.data.length : 0;
          } catch { counts[id] = 0; }
        }),
      );
      return counts;
    },
  );
  const branchCounts = branchCountData ?? {};
  const allowedBrands = permData?.data?.brands ?? [];
  const isAdmin = permData?.data?.isAdmin ?? false;
  const freshness = freshnessData?.data ?? {};
  const workspaceBrand =
    inWorkspace && globalBrand && dashboardReady[globalBrand] ? globalBrand : null;
  const currentBrand = workspaceBrand ? BRANDS.find((b) => b.id === workspaceBrand) : null;

  useEffect(() => {
    if (!permData?.data?.dashboardReady || urlBrandSynced.current) return;
    urlBrandSynced.current = true;
    if (brandFromUrl && dashboardReady[brandFromUrl]) {
      setInWorkspace(true);
      if (globalBrand !== brandFromUrl) {
        void setGlobalBrand(brandFromUrl);
      }
    }
  }, [permData, brandFromUrl, dashboardReady, globalBrand, setGlobalBrand]);

  const selectBrand = useCallback(
    async (brandId: string) => {
      if (globalBrand !== brandId) {
        await setGlobalBrand(brandId);
      }
      setInWorkspace(true);
    },
    [globalBrand, setGlobalBrand],
  );

  /* ═══ Phase 1: Brand Selection ═══ */
  if (!workspaceBrand) {
    return (
      <PageContainer className="py-0 px-3 sm:px-0" maxWidth="2k">
        <div className="text-center text-[11px] py-1.5 px-3 -mx-3 sm:mx-0 mb-2" style={{ background: "#dbeafe", color: "#1e40af" }}>
          BETA — You may encounter issues. Your feedback helps us improve. Contact <strong>Muh</strong> or <strong>Oab</strong> (IT)
        </div>
        <div className="flex flex-col items-center justify-center" style={{ minHeight: "calc(100vh - 160px)" }}>
          <img src="/codexfamilylogo/logo_3_speed_256.png" alt="" width={120} height={120} className="mb-4" />
          <h1 className="text-[24px] sm:text-[28px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
            Fast Intelligence
          </h1>
          <p className="text-[13px] mb-1" style={{ color: "var(--text-muted)" }}>
            Select a brand to view reports & dashboards
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-2xl">
            {BRANDS.filter((b) => b.enabled).map((brand) => {
              const isDashboardReady = !!dashboardReady[brand.id];
              const hasPermission = isAdmin || allowedBrands.includes(brand.id);
              const isNotReady = !isDashboardReady;
              const isLocked = isDashboardReady && !hasPermission;
              const isDisabled = isNotReady || isLocked;
              return (
                <button
                  key={brand.id}
                  onClick={() => { if (!isDisabled) void selectBrand(brand.id); }}
                  disabled={isDisabled}
                  className="flex flex-col items-center gap-4 px-8 py-8 rounded-2xl cursor-pointer transition-all disabled:cursor-not-allowed disabled:opacity-35 group"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-card)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <img
                    src={brand.logo}
                    alt={brand.name}
                    width={96}
                    height={96}
                    className="rounded-xl object-contain transition-transform group-hover:scale-110"
                    style={{ filter: isDisabled ? "grayscale(1)" : undefined }}
                  />
                  <p className="text-[16px] font-bold" style={{ color: "var(--text-heading)" }}>{brand.name}</p>
                  {!isDisabled && branchCounts[brand.id] != null && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg" style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                      {branchCounts[brand.id]} branches
                    </span>
                  )}
                  {isNotReady && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: "var(--color-warning-light)", color: "var(--text-inverse)" }}>SOON</span>
                  )}
                  {isLocked && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded" style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}>No access</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* No access message */}
          {permData && !isAdmin && allowedBrands.length === 0 && (
            <p className="text-[12px] mt-4 px-4 py-2 rounded-lg text-center" style={{ background: "#fef2f2", color: "#991b1b" }}>
              You don't have access to any brand yet. Contact your IT Admin to request access.
            </p>
          )}

          {/* Architecture + Data Sources link */}
          <div className="flex items-center gap-3 mt-8">
            <button
              onClick={() => setShowArch(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer border-none transition-colors text-[11px] font-medium"
              style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
            >
              <Info size={12} /> How it works
            </button>
            {DATA_SOURCES.filter((s) => s.enabled).map((src) => {
              const f = freshness[src.name];
              const syncDate = f?.lastDate ? new Date(f.lastDate) : null;
              return (
                <div key={src.name} className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {src.logo ? <img src={src.logo} alt="" width={12} height={12} className="rounded" /> : null}
                  {src.name}
                  {syncDate && <span style={{ color: "var(--color-success)" }}>{formatDistanceToNow(syncDate, { addSuffix: true })}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Architecture Modal */}
        {showArch && <ArchModal selectedBrand="UNO" freshness={freshness} onClose={() => setShowArch(false)} />}
      </PageContainer>
    );
  }

  /* ═══ Phase 2: Brand Workspace (reports + dashboards) ═══ */
  return (
    <PageContainer className="py-0 px-3 sm:px-0" maxWidth="2k">
      <div className="text-center text-[11px] py-1.5 px-3 -mx-3 sm:mx-0 mb-2" style={{ background: "#dbeafe", color: "#1e40af" }}>
        BETA — You may encounter issues. Your feedback helps us improve. Contact <strong>Muh</strong> or <strong>Oab</strong> (IT)
      </div>
      {/* Header */}
      <PageHeaderCard className="flex items-center gap-2.5 flex-wrap mb-4">
        <BackButton onClick={() => setInWorkspace(false)} label="Back to brand selection" />
        {currentBrand && <img src={currentBrand.logo} alt={currentBrand.name} width={40} height={40} className="rounded-xl" />}

        <div className="flex-1" />

        {/* Data freshness */}
        <div className="flex items-center gap-2 flex-wrap">
          {DATA_SOURCES.filter((s) => s.enabled && (!s.name.startsWith("Foodstory ") || s.name === `Foodstory ${workspaceBrand}`)).map((src) => {
            const f = freshness[src.name];
            const syncDate = f?.lastDate ? new Date(f.lastDate) : null;
            return (
              <div key={src.name} className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                {src.logo ? <img src={src.logo} alt="" width={14} height={14} className="rounded shrink-0" /> : <span className="text-[11px]">📍</span>}
                <span className="text-[10px] font-medium" style={{ color: "var(--text-primary)" }}>{src.name}</span>
                {syncDate ? (
                  <span className="text-[10px]" style={{ color: "var(--color-success)" }}>
                    {format(syncDate, "dd MMM HH:mm")} · {formatDistanceToNow(syncDate, { addSuffix: true })}
                  </span>
                ) : <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>—</span>}
              </div>
            );
          })}
          <button onClick={() => setShowArch(true)} className="flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer border-none text-[10px] font-medium" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
            <Info size={11} /> Architecture
          </button>
        </div>
      </PageHeaderCard>

      {/* Dashboards */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2.5">
          <h2 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>Dashboards</h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>Visual charts &amp; KPIs</span>
        </div>

        {/* ── Master Dashboard — featured card ── */}
        {(() => {
          const masterDash = CUSTOM_DASHBOARDS[0]; // id: "master"
          const isMasterReady = !!dashboardReady[workspaceBrand];
          return isMasterReady ? (
            <HoverCard
              href={`${masterDash.href}?brand=${workspaceBrand}`}
              className="flex items-center gap-5 p-5 mb-3 block"
              style={{
                background: "var(--nav-active-bg)",
                borderWidth: 2,
                borderColor: "var(--nav-active-text)",
              }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "var(--bg-card)" }}
              >
                <BarChart3 size={28} className="text-[var(--nav-active-text)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-[17px] font-bold" style={{ color: "var(--nav-active-text)" }}>
                    {masterDash.name}
                  </h3>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "var(--nav-active-text)", color: "var(--bg-card)" }}
                  >
                    FEATURED
                  </span>
                </div>
                <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                  {masterDash.description}
                </p>
              </div>
            </HoverCard>
          ) : (
            <div
              className="flex items-start gap-4 rounded-2xl p-5 mb-3"
              style={{
                background: "var(--bg-card)",
                border: "2px solid var(--border-card)",
                opacity: 0.9,
              }}
            >
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "var(--bg-badge)" }}
              >
                <BarChart3 size={28} style={{ color: "var(--text-faint)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-[17px] font-bold" style={{ color: "var(--text-heading)" }}>
                    {masterDash.name}
                  </h3>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}
                  >
                    FEATURED
                  </span>
                </div>
                <p className="text-[13px] mb-2" style={{ color: "var(--text-muted)" }}>
                  {masterDash.description}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <AlertTriangle size={13} style={{ color: "#f59e0b" }} />
                  <span className="text-[12px]" style={{ color: "#92400e" }}>
                    Dashboard DB ไม่ได้ config สำหรับ {workspaceBrand}
                  </span>
                  {canConfigBrands && (
                    <Link
                      href="/settings/brand-config"
                      className="text-[12px] font-semibold underline ml-1"
                      style={{ color: "#2563eb" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      ตั้งค่าที่นี่ →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Remaining dashboards (skip master — already featured above) ── */}
        {SHOW_REMAINING_DASHBOARDS && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {CUSTOM_DASHBOARDS.slice(1).map((dash) => {
              const Icon = ICON_MAP[dash.icon];
              return (
                <HoverCard key={dash.id} href={`${dash.href}?brand=${workspaceBrand}`} className="p-4 flex items-center gap-3 block">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--nav-active-bg)" }}>
                    {Icon && <Icon size={20} className="text-[var(--nav-active-text)]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>{dash.name}</h3>
                    <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{dash.description}</p>
                  </div>
                </HoverCard>
              );
            })}
          </div>
        )}
      </div>

      {/* Reports */}
      {SHOW_REPORTS && (
        <div>
        <div className="flex items-center gap-2 mb-2.5">
          <h2 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>Reports</h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>Interactive data tables with filters</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
          {REPORTS.map((report) => {
            const isSoon = "soon" in report && (report as { soon?: boolean }).soon;
            const source = "source" in report ? (report as { source?: string }).source : null;
            const inner = (
              <>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[22px] leading-none">{report.icon}</span>
                  <span className="text-[14px] font-bold leading-tight" style={{ color: "var(--text-heading)" }}>{report.label}</span>
                  {isSoon && <span className="text-[9px] font-bold px-1 py-0.5 rounded ml-auto" style={{ background: "var(--color-warning-light)", color: "var(--text-inverse)" }}>SOON</span>}
                </div>
                <p className="text-[12px] leading-snug" style={{ color: "var(--text-muted)" }}>{report.desc}</p>
                {source && <p className="text-[10px] mt-1 font-medium" style={{ color: "var(--text-faint)" }}>{source}</p>}
              </>
            );
            return isSoon ? (
              <div key={report.id} className="rounded-xl p-4 opacity-60" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>{inner}</div>
            ) : (
              <HoverCard key={report.id} href={`/intelligence/reports/${report.id}?brand=${workspaceBrand}`} className="p-4 block">
                {inner}
              </HoverCard>
            );
          })}
        </div>
        </div>
      )}

      {/* Architecture Modal */}
      {showArch && <ArchModal selectedBrand={workspaceBrand} freshness={freshness} onClose={() => setShowArch(false)} />}
    </PageContainer>
  );
}

/* ═══ Architecture Modal (extracted to reduce main component size) ═══ */

function ArchModal({ selectedBrand, onClose }: { selectedBrand: string; freshness: Record<string, unknown>; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: "var(--overlay-bg)" }} onClick={onClose} />
      <div
        className="fixed z-50 top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] rounded-2xl overflow-hidden"
        style={{ width: "90vw", maxWidth: "1400px", maxHeight: "92vh", background: "var(--bg-modal)", border: "1px solid var(--border-main)", boxShadow: "var(--shadow-modal)", animation: "dialogIn 0.2s var(--ease-out-expo)" }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border-main)" }}>
          <div>
            <h2 className="text-[20px] font-bold" style={{ color: "var(--text-heading)" }}>Data Architecture</h2>
            <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>How data flows from source systems into Fast Intelligence</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none" style={{ background: "transparent", color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>
        <div className="p-8 overflow-y-auto" style={{ maxHeight: "calc(92vh - 80px)" }}>
          <div className="flex items-stretch gap-0 min-h-[480px]">
            {/* COL 1: Source Systems */}
            <div className="flex-1 min-w-0">
              <div className="rounded-xl p-5 h-full" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
                <p className="text-[12px] font-bold mb-4 text-center tracking-widest" style={{ color: "var(--text-faint)" }}>SOURCE SYSTEMS</p>
                <div className="flex flex-col gap-2.5">
                  {[
                    { name: "Foodstory POS", logo: "/brandlogo/foodstory.png", icon: "🍽️", color: "#dc2626", enabled: true, tables: ["BillDetail", "MasterMenu", "MasterBranch"], desc: "UNO & KSI — separate DB per brand", freq: "On demand" },
                    { name: "Business Central", logo: "/brandlogo/d365-business-central.png", icon: "📊", color: "#0078d4", enabled: false, tables: ["Recipe / BOM", "Inventory", "Financials"], desc: "ERP", freq: "Daily" },
                    { name: "Location Master", logo: "", icon: "📍", color: "#16a34a", enabled: true, tables: ["Branches", "Regions"], desc: "Stores", freq: "Hourly" },
                  ].map((src) => (
                    <div key={src.name} className="rounded-lg px-4 py-3" style={{ background: "var(--bg-card)", border: `1px solid ${src.color}30`, borderLeft: `4px solid ${src.color}` }}>
                      <div className="flex items-center gap-2.5 mb-2">
                        {src.logo ? <img src={src.logo} alt="" width={24} height={24} className="rounded shrink-0" /> : <span className="text-[18px]">{src.icon}</span>}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>{src.name}</span>
                            {!src.enabled && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--color-warning-light)", color: "var(--text-inverse)" }}>SOON</span>}
                          </div>
                          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{src.desc}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {src.tables.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded" style={{ background: src.color + "10", color: src.color, border: `1px solid ${src.color}25` }}>{t}</span>)}
                      </div>
                      <p className="text-[10px] font-medium" style={{ color: src.enabled ? "var(--color-success)" : "var(--text-muted)" }}>{src.enabled ? "● Connected" : "○ Coming soon"} · {src.freq}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Arrow */}
            <div className="flex flex-col items-center justify-center px-3 shrink-0">
              <div className="h-0.5 w-8" style={{ background: "var(--border-main)" }} />
              <div className="text-[11px] font-bold px-3 py-1.5 rounded-lg my-1 whitespace-nowrap" style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>Auto<br />Sync</div>
              <div className="h-0.5 w-8" style={{ background: "var(--border-main)" }} />
              <span className="text-[16px] mt-1" style={{ color: "var(--text-faint)" }}>→</span>
            </div>
            {/* COL 2: Processing */}
            <div className="flex-1 min-w-0">
              <div className="rounded-xl p-5 h-full flex flex-col" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
                <p className="text-[12px] font-bold mb-4 text-center tracking-widest" style={{ color: "var(--text-faint)" }}>DATA PROCESSING</p>
                <div className="flex flex-col gap-2 flex-1">
                  {[
                    { emoji: "🔄", label: "Collect", color: "var(--color-action)", desc: "Pull from source systems", detail: "Semi-auto" },
                    { emoji: "📦", label: "Store", color: "var(--color-warning)", desc: "Full history, separate DB per brand", detail: "Raw data" },
                    { emoji: "✨", label: "Clean", color: "var(--color-purple)", desc: "Deduplicate, fix errors, add labels", detail: "Quality checks" },
                  ].map((stage, i) => (
                    <div key={stage.label}>
                      <div className="flex items-start gap-3 rounded-lg px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-[16px]" style={{ background: `${stage.color}12`, border: `2px solid ${stage.color}` }}>{stage.emoji}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>{stage.label}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: `${stage.color}12`, color: stage.color }}>{stage.detail}</span>
                          </div>
                          <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>{stage.desc}</p>
                        </div>
                      </div>
                      {i < 2 && <div className="flex justify-center py-0.5"><span className="text-[12px]" style={{ color: "var(--text-faint)" }}>↓</span></div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Arrow */}
            <div className="flex flex-col items-center justify-center px-3 shrink-0">
              <div className="h-0.5 w-8" style={{ background: "var(--border-main)" }} />
              <div className="text-[11px] font-bold px-3 py-1.5 rounded-lg my-1 whitespace-nowrap" style={{ background: "var(--color-success)", color: "#fff" }}>Data<br />Ready</div>
              <div className="h-0.5 w-8" style={{ background: "var(--border-main)" }} />
              <span className="text-[16px] mt-1" style={{ color: "var(--text-faint)" }}>→</span>
            </div>
            {/* COL 3: Intelligence */}
            <div className="flex-1 min-w-0">
              <div className="rounded-xl p-5 h-full flex flex-col" style={{ background: "var(--nav-active-bg)", border: "2px solid var(--nav-active-text)" }}>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <BarChart3 size={24} style={{ color: "var(--nav-active-text)" }} />
                  <p className="text-[18px] font-bold" style={{ color: "var(--nav-active-text)" }}>Fast Intelligence</p>
                </div>
                <p className="text-[12px] text-center mb-4" style={{ color: "var(--text-muted)" }}>What you see and interact with</p>
                <div className="flex flex-col gap-2 flex-1">
                  {[
                    { icon: "📊", label: "Reports", desc: "Pre-calculated totals with interactive tables" },
                    { icon: "📈", label: "Dashboards", desc: "Charts filtered by brand, date, branch" },
                    { icon: "🎯", label: "KPIs", desc: "Revenue, growth, avg ticket at a glance" },
                    { icon: "🔔", label: "Exports", desc: "Excel, email, scheduled delivery" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[16px]">{item.icon}</span>
                        <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{item.label}</span>
                      </div>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center justify-between mt-6 pt-4" style={{ borderTop: "1px solid var(--border-light)" }}>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ background: "var(--color-success)" }} /><span className="text-[13px]" style={{ color: "var(--text-muted)" }}>Connected</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ background: "var(--text-faint)" }} /><span className="text-[13px]" style={{ color: "var(--text-muted)" }}>Coming soon</span></div>
            </div>
            <p className="text-[12px] font-medium" style={{ color: "var(--text-faint)" }}>Rocks Fast Data Platform</p>
          </div>
        </div>
      </div>
    </>
  );
}
