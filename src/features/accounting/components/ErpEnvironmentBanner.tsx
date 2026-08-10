"use client";

import { AlertTriangle } from "lucide-react";
import { erpEnvironmentLabel } from "@/lib/acc/erp-environment-shared";
import { useErpInterfaceEnvironment } from "@/features/accounting/hooks/useErpInterfaceEnvironment";

/**
 * Shown when System Admin has enabled Sandbox — warns that Interface uses UAT data.
 */
export function ErpEnvironmentBanner() {
  const { env, ready } = useErpInterfaceEnvironment();

  if (!ready || !env.canUseSandbox || env.effectiveEnvironment !== "Sandbox") {
    return null;
  }

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-xl px-4 py-3"
      style={{
        background: "color-mix(in srgb, var(--text-warning) 12%, var(--bg-card))",
        border: "1px solid color-mix(in srgb, var(--text-warning) 35%, var(--border-card))",
      }}
    >
      <AlertTriangle
        size={18}
        className="shrink-0 mt-0.5"
        style={{ color: "var(--text-warning)" }}
      />
      <div>
        <p className="text-[13px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
          โหมด {erpEnvironmentLabel("Sandbox")}
        </p>
        <p className="text-[12px] m-0 mt-0.5" style={{ color: "var(--text-secondary)" }}>
          คุณกำลังใช้ข้อมูล UAT/Sandbox สำหรับ Interface ERP — ผู้ใช้อื่นจะยังคงใช้ Production เสมอ
        </p>
      </div>
    </div>
  );
}
