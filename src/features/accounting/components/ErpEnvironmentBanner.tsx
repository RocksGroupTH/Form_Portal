"use client";

import { AlertTriangle } from "lucide-react";
import { erpEnvironmentLabel } from "@/lib/acc/erp-environment-shared";
import { useErpInterfaceEnvironment } from "@/features/accounting/hooks/useErpInterfaceEnvironment";

/**
 * Shown on accounting pages whose form is flagged UAT — their journals go to
 * BC Sandbox. Everyone sees it, not just System Admin: the environment is a
 * property of the form now, not of who is looking at it.
 */
export function ErpEnvironmentBanner() {
  const { env, ready } = useErpInterfaceEnvironment();

  if (!ready || env.effectiveEnvironment !== "Sandbox") {
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
          ฟอร์มนี้ถูกตั้งเป็น UAT — เอกสารที่ส่งจะเข้า Business Central Sandbox ไม่ใช่ตัวจริง
        </p>
      </div>
    </div>
  );
}
