"use client";

import type { CSSProperties } from "react";
import { FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { useErpInterfaceEnvironment } from "@/features/accounting/hooks/useErpInterfaceEnvironment";
import { useErpSandboxDevHost } from "@/features/accounting/hooks/useErpSandboxDevHost";
import { erpEnvironmentLabel } from "@/lib/acc/erp-environment-shared";

interface ErpEnvironmentNavBadgeProps {
  /** Shorter label for mobile top bar */
  compact?: boolean;
}

/**
 * ERP PRO/UAT indicator — visible only on localhost:3021 (local dev testing).
 */
export function ErpEnvironmentNavBadge({ compact = false }: ErpEnvironmentNavBadgeProps) {
  const { status } = useSession();
  const devHost = useErpSandboxDevHost();
  const { env, ready, toggling, isSandbox, toggleEnvironment } = useErpInterfaceEnvironment();

  if (status !== "authenticated" || !devHost) return null;

  const label = isSandbox ? "UAT" : "PRO";
  const nextLabel = isSandbox ? "PRO" : "UAT";
  const fullLabel = isSandbox ? erpEnvironmentLabel("Sandbox") : "Production";
  const canToggle = env.canConfigure && !toggling;
  const title = env.canConfigure
    ? `${fullLabel} — คลิกเพื่อสลับเป็น ${nextLabel}`
    : `ERP Interface: ${fullLabel}`;

  const content = (
    <>
      {toggling ? (
        <Loader2 size={compact ? 11 : 12} className="shrink-0 animate-spin" />
      ) : isSandbox ? (
        <FlaskConical size={compact ? 11 : 12} className="shrink-0" />
      ) : (
        <ShieldCheck size={compact ? 11 : 12} className="shrink-0" />
      )}
      {!compact && (
        <span className="text-[10px] font-medium opacity-80 hidden lg:inline">ERP</span>
      )}
      <span className="font-bold">{label}</span>
    </>
  );

  const className = `inline-flex items-center gap-1 rounded-md font-semibold border-none transition-all ${
    compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"
  } ${canToggle ? "cursor-pointer hover:opacity-90 active:scale-[0.97]" : "cursor-default"}`;

  const style: CSSProperties = isSandbox
    ? {
        background: "var(--bg-info-yellow)",
        color: "var(--text-warning)",
        border: "1px solid var(--border-info-yellow)",
        opacity: toggling ? 0.75 : 1,
      }
    : {
        background: "var(--bg-info-green)",
        color: "var(--text-info-green)",
        border: "1px solid var(--border-info-green)",
        opacity: toggling ? 0.75 : 1,
      };

  if (!ready) {
    return (
      <span
        className={`inline-block rounded-md animate-pulse ${compact ? "w-10 h-5" : "w-14 h-6"}`}
        style={{ background: "var(--bg-badge)" }}
        aria-hidden
      />
    );
  }

  if (env.canConfigure) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        title={title}
        aria-label={title}
        disabled={toggling}
        onClick={() => void toggleEnvironment()}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={className} style={style} title={title}>
      {content}
    </span>
  );
}
