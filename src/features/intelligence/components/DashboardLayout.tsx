"use client";
import React, { useState, useCallback } from "react";
import { HelpCircle, Sparkles, Loader2, TrendingUp, Lightbulb, AlertTriangle, Zap, Swords } from "lucide-react";
import { BackButton } from "@/components/layout/BackButton";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { format, formatDistanceToNow } from "date-fns";
import { DateRangeFilter } from "./DateRangeFilter";
import { Dialog } from "@/components/ui/Dialog";

/* ── Module-level constants (avoid re-creation per render) ── */

const CLAUDE_LOGO = <svg viewBox="0 0 24 24" className="w-4 h-4"><circle cx="12" cy="12" r="11" fill="#D97757"/><path d="M9.5 15L14 8.5c.2-.3.5-.3.7 0l1.5 3.3" stroke="#F5E6DC" strokeWidth="1.5" strokeLinecap="round" fill="none"/><path d="M14.5 9L10 15.5c-.2.3-.5.3-.7 0L7.8 12.2" stroke="#F5E6DC" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>;
const OPENAI_LOGO = <svg viewBox="0 0 24 24" className="w-4 h-4"><circle cx="12" cy="12" r="11" fill="#10a37f"/><path d="M12 7v5l3 3M7 12a5 5 0 1 1 10 0 5 5 0 0 1-10 0z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>;
const GEMINI_LOGO = <svg viewBox="0 0 24 24" className="w-4 h-4"><circle cx="12" cy="12" r="11" fill="#4285f4"/><path d="M12 6c0 3.3-2.7 6-6 6 3.3 0 6 2.7 6 6 0-3.3 2.7-6 6-6-3.3 0-6-2.7-6-6z" fill="#fff"/></svg>;

const AI_PROVIDERS = [
  { id: "claude", label: "Claude Sonnet 4.6", color: "#D97757", bg: "rgba(217,119,87,0.12)", enabled: true, logo: CLAUDE_LOGO },
  { id: "openai", label: "GPT-4o", color: "#10a37f", bg: "rgba(16,163,127,0.12)", enabled: false, logo: OPENAI_LOGO },
  { id: "gemini", label: "Gemini 2.5 Pro", color: "#4285f4", bg: "rgba(66,133,244,0.12)", enabled: false, logo: GEMINI_LOGO },
] as const;

const FINDING_CONFIG: Record<string, { icon: React.ReactNode; accent: string; label: string }> = {
  trend: { icon: <TrendingUp size={16} />, accent: "#2563eb", label: "TREND" },
  opportunity: { icon: <Lightbulb size={16} />, accent: "#f59e0b", label: "OPPORTUNITY" },
  warning: { icon: <AlertTriangle size={16} />, accent: "#dc2626", label: "WATCH" },
  action: { icon: <Zap size={16} />, accent: "#16a34a", label: "ACTION" },
  competitor: { icon: <Swords size={16} />, accent: "#7c3aed", label: "COMPETITOR" },
};

interface Branch {
  branchId: string;
  branchName: string;
}

export interface InsightPayload {
  kpis: Record<string, string | number>;
  vsKpis?: Record<string, string | number> | null;
  summary?: string;
  dailyTrend?: string;
  dateRange?: string;
}

interface DashboardLayoutProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  brand: string;
  onBrandChange: (b: string) => void;
  period: string;
  onPeriodChange: (p: string) => void;
  /** Hide the brand chip + the optional `icon` next to the title.
   *  Use for pages where the brand context is already obvious from
   *  surrounding chrome and the title alone should carry the header. */
  hideBrandLogo?: boolean;
  hideFiltersRow?: boolean;
  branch?: string;
  onBranchChange?: (b: string) => void;
  branches?: Branch[];
  freshness?: Record<string, { lastDate: string | null }>;
  helpContent?: React.ReactNode;
  vs?: boolean;
  onVsChange?: (v: boolean) => void;
  vsLabel?: string;
  insightData?: InsightPayload | null;
  codexInsights?: { general: Array<{ type: string; title: string; body: string }> } | null;
  children: React.ReactNode;
}

export function DashboardLayout({
  title,
  description,
  icon,
  brand,
  onBrandChange,
  period,
  onPeriodChange,
  hideBrandLogo = false,
  hideFiltersRow = false,
  branch,
  onBranchChange,
  branches,
  freshness,
  helpContent,
  vs,
  onVsChange,
  vsLabel,
  insightData,
  codexInsights,
  children,
}: DashboardLayoutProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [insightOpen, setInsightOpen] = useState(false);
  const [insightReport, setInsightReport] = useState<{
    headline?: string | null;
    summary?: string | null;
    findings: Array<{ type: string; title: string; body: string; metric?: string; change?: string }>;
  } | null>(null);
  const [insightFallback, setInsightFallback] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightProvider, setInsightProvider] = useState("");

  const requestInsight = useCallback(async (provider: string) => {
    if (insightLoading) return;
    setInsightProvider(provider);
    setInsightOpen(true);
    setInsightReport(null);
    setInsightFallback("");

    // Codex: instant offline rules
    if (provider === "codex") {
      if (codexInsights?.general && codexInsights.general.length > 0) {
        setInsightReport({ headline: null, summary: null, findings: codexInsights.general });
      } else {
        setInsightFallback("No insights available for current data.");
      }
      return;
    }

    if (!insightData) return;
    setInsightLoading(true);
    try {
      const res = await fetch("/api/intelligence/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboard: title,
          brand,
          period,
          provider,
          kpis: insightData.kpis,
          vsKpis: insightData.vsKpis,
          summary: insightData.summary,
          dailyTrend: insightData.dailyTrend,
          dateRange: insightData.dateRange,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        if (json.data.report) {
          setInsightReport(json.data.report);
        } else {
          setInsightFallback(json.data.fallbackText || "No insights available");
        }
      } else {
        setInsightFallback(`Error: ${json.error || "Failed to get insight"}`);
      }
    } catch {
      setInsightFallback("Error: Could not connect to AI service");
    } finally {
      setInsightLoading(false);
    }
  }, [insightData, insightLoading, codexInsights, title, brand, period]);

  return (
    <div className="flex flex-col gap-5">
      {/* Back + Header */}
      <PageHeaderCard className="flex flex-wrap items-center gap-3">
        <BackButton href={`/intelligence?brand=${brand}`} />
        {!hideBrandLogo && (
          <>
            <img src={`/brandlogo/${brand.toLowerCase()}-200.png`} alt={brand} width={28} height={28} className="rounded-lg object-contain shrink-0" />
            {icon && (
              <span className="shrink-0" style={{ color: "var(--nav-active-text)" }}>
                {icon}
              </span>
            )}
          </>
        )}
        <div>
          <h1 className="text-[20px] font-bold leading-tight" style={{ color: "var(--text-heading)" }}>
            {title}
          </h1>
          {description && (
            <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>{description}</p>
          )}
        </div>
        {helpContent && (
          <button
            onClick={() => setHelpOpen(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-badge)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            title="How this dashboard works"
          >
            <HelpCircle size={16} />
          </button>
        )}
        {/* AI Insight */}
        {insightData && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
            style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)" }}
          >
            <Sparkles size={12} style={{ color: "var(--text-muted)" }} />
            <span className="text-[10px] font-medium hidden sm:inline" style={{ color: "var(--text-muted)" }}>AI Insight</span>
            <div className="w-px h-3.5 shrink-0" style={{ background: "var(--border-light)" }} />
            {AI_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => p.enabled && requestInsight(p.id)}
                disabled={!p.enabled || insightLoading}
                className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full transition-all ${p.enabled ? "cursor-pointer" : "cursor-not-allowed"}`}
                style={{
                  background: p.enabled ? p.bg : "transparent",
                  color: p.enabled ? p.color : "var(--text-muted)",
                  border: p.enabled ? `1px solid ${p.color}30` : "1px solid var(--border-card)",
                  opacity: !p.enabled ? 0.4 : insightLoading ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { if (p.enabled) { e.currentTarget.style.background = p.color; e.currentTarget.style.color = "#fff"; } }}
                onMouseLeave={(e) => { if (p.enabled) { e.currentTarget.style.background = p.bg; e.currentTarget.style.color = p.color; } }}
                title={p.enabled ? p.label : `${p.label} — Coming soon`}
              >
                {p.logo}
                <span className="hidden sm:inline">{p.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {/* Data freshness */}
        {freshness && (() => {
          const fs = freshness[`Foodstory ${brand}`];
          const syncDate = fs?.lastDate ? new Date(fs.lastDate) : null;
          return syncDate ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg w-full sm:w-auto order-last sm:order-none"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <img src="/brandlogo/foodstory.png" alt="" width={14} height={14} className="rounded" />
              <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>Last sync</span>
              <span className="text-[10px]" style={{ color: "var(--color-success)" }}>
                {format(syncDate, "dd MMM HH:mm")} · {formatDistanceToNow(syncDate, { addSuffix: true })}
              </span>
            </div>
          ) : null;
        })()}
      </PageHeaderCard>

      {/* Filters row */}
      {!hideFiltersRow && (
        <div className="flex items-center gap-3 flex-wrap">
          <DateRangeFilter value={period} onChange={onPeriodChange} />
          {branches && onBranchChange && (
            <>
              <div className="w-px h-5 shrink-0" style={{ background: "var(--border-light)" }} />
              <select
                value={branch ?? ""}
                onChange={(e) => onBranchChange(e.target.value)}
                className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
              >
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>{b.branchName}</option>
                ))}
              </select>
            </>
          )}
          {/* Compare group */}
          {onVsChange && (
            <>
              <div className="w-px h-5 shrink-0" style={{ background: "var(--border-light)" }} />
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)" }}
              >
                <button
                  onClick={() => onVsChange(!vs)}
                  className="text-[11px] font-bold px-2.5 py-0.5 rounded-full cursor-pointer transition-colors"
                  style={{
                    background: vs ? "var(--nav-active-bg)" : "transparent",
                    color: vs ? "var(--nav-active-text)" : "var(--text-muted)",
                  }}
                >
                  VS{vs && vsLabel ? `: ${vsLabel}` : ""}
                </button>
                <div className="w-px h-3.5 shrink-0" style={{ background: "var(--border-light)" }} />
                <button
                  disabled
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full opacity-40 cursor-not-allowed"
                  style={{ color: "var(--text-muted)" }}
                  title="Coming soon"
                >
                  BD Target
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Dashboard content */}
      <div>{children}</div>

      {/* Help modal */}
      {helpContent && (
        <Dialog open={helpOpen} onOpenChange={setHelpOpen} title={`${title} — How it works`} contentClassName="max-w-xl">
          <div className="text-[13px] leading-relaxed space-y-3 mt-2" style={{ color: "var(--text-secondary)" }}>
            {helpContent}
          </div>
        </Dialog>
      )}

      {/* AI Insight modal */}
      <Dialog open={insightOpen} onOpenChange={setInsightOpen} title="Insight Report" contentClassName="max-w-[95vw] lg:max-w-[85vw]">
        {insightLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-5">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 64 64" className="w-16 h-16" style={{ animation: "claudePulse 2s ease-in-out infinite" }}>
                <defs><linearGradient id="claudeGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#D97757" /><stop offset="100%" stopColor="#C4643D" /></linearGradient></defs>
                <circle cx="32" cy="32" r="30" fill="url(#claudeGrad)" />
                <path d="M25.5 38.5L35.2 21.6C35.6 20.9 36.4 20.9 36.7 21.6L40.5 30.3" stroke="#F5E6DC" strokeWidth="2.8" strokeLinecap="round" fill="none" />
                <path d="M38.5 25.5L28.8 42.4C28.4 43.1 27.6 43.1 27.3 42.4L23.5 33.7" stroke="#F5E6DC" strokeWidth="2.8" strokeLinecap="round" fill="none" />
              </svg>
              <div className="absolute inset-0" style={{ animation: "claudeSpin 3s linear infinite" }}><div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full" style={{ background: "#D97757", opacity: 0.6 }} /></div>
              <div className="absolute inset-0" style={{ animation: "claudeSpin 3s linear infinite reverse" }}><div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: "#7c3aed", opacity: 0.5 }} /></div>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-[14px] font-semibold" style={{ color: "var(--text-heading)" }}>Generating Insight Report</span>
              <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>Analyzing data & searching competitors...</span>
            </div>
            <div className="w-48 h-1 rounded-full overflow-hidden" style={{ background: "var(--border-card)" }}>
              <div className="h-full rounded-full" style={{ background: "linear-gradient(90deg, #D97757, #7c3aed, #D97757)", backgroundSize: "200% 100%", animation: "claudeBar 1.5s ease-in-out infinite" }} />
            </div>
          </div>
        ) : insightReport ? (() => {
          const prov = AI_PROVIDERS.find((p) => p.id === insightProvider);
          return (
            <div className="mt-2">
              {/* Report header */}
              <div className="flex items-center justify-between mb-1">
                <div>
                  <div className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: "#A3121B" }}>Insight Report</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{title} · {brand} · {period}</div>
                </div>
                {prov && (
                  <div className="flex items-center gap-1.5">
                    {prov.logo}
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{prov.label}</span>
                  </div>
                )}
              </div>
              <div className="h-px my-4" style={{ background: "var(--border-main)" }} />

              {/* Headline */}
              {insightReport.headline && (
                <p className="text-[18px] font-bold leading-snug mb-2" style={{ color: "var(--text-heading)" }}>
                  {insightReport.headline}
                </p>
              )}

              {/* Executive summary */}
              {insightReport.summary && (
                <p className="text-[13px] leading-relaxed mb-5" style={{ color: "var(--text-secondary)" }}>
                  {insightReport.summary}
                </p>
              )}

              {(insightReport.headline || insightReport.summary) && (
                <div className="h-px mb-5" style={{ background: "var(--border-light)" }} />
              )}

              {/* Key findings */}
              <div className="text-[10px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: "var(--text-muted)" }}>Key Findings</div>
              <div className="flex flex-col gap-4">
                {insightReport.findings.map((item, i) => {
                  const fc = FINDING_CONFIG[item.type] ?? FINDING_CONFIG.trend;
                  return (
                    <div key={i} className="flex gap-4">
                      {/* Number */}
                      <div className="text-[24px] font-bold leading-none shrink-0 w-8 text-right" style={{ color: "var(--border-card)" }}>
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="flex items-center gap-1 text-[9px] font-bold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded" style={{ color: fc.accent, background: `${fc.accent}12` }}>
                            {fc.icon} {fc.label}
                          </span>
                        </div>
                        <div className="text-[14px] font-bold leading-tight" style={{ color: "var(--text-heading)" }}>{item.title}</div>
                        <div className="text-[13px] leading-relaxed mt-1" style={{ color: "var(--text-secondary)" }}>{item.body}</div>
                      </div>
                      {/* Metric */}
                      {(item.metric || item.change) && (
                        <div className="shrink-0 text-right">
                          {item.metric && <div className="text-[18px] font-bold" style={{ color: "var(--text-heading)" }}>{item.metric}</div>}
                          {item.change && (
                            <div className="text-[12px] font-semibold" style={{ color: item.change.startsWith("-") ? "#dc2626" : "#16a34a" }}>
                              {item.change}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="h-px mt-6 mb-3" style={{ background: "var(--border-light)" }} />
              <p className="text-[9px] italic mb-3" style={{ color: "var(--text-muted)" }}>AI-generated insights may not be fully accurate. Please verify with actual data before making decisions.</p>
              <div className="flex items-center justify-between">
                <span className="text-[9px] tracking-[0.1em] uppercase" style={{ color: "var(--text-muted)" }}>IT Codex Family Intelligence</span>
                {prov && (
                  <div className="flex items-center gap-1.5">
                    {prov.logo}
                    <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>Powered by {prov.label} · Web Search</span>
                  </div>
                )}
              </div>
            </div>
          );
        })() : (
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap mt-4" style={{ color: "var(--text-secondary)" }}>
            {insightFallback}
          </div>
        )}
      </Dialog>
    </div>
  );
}
