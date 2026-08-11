export type ErpBcEnvironment = "Production" | "Sandbox";

/** Hosts where UAT/Sandbox may be enabled (local dev only). */
export const ERP_SANDBOX_ALLOWED_HOSTS = ["localhost:3020", "127.0.0.1:3020"] as const;

export function isErpSandboxHostAllowed(host?: string | null): boolean {
  const h = (host ?? "").toLowerCase().trim();
  return (ERP_SANDBOX_ALLOWED_HOSTS as readonly string[]).includes(h);
}

export interface ErpEnvironmentInfo {
  effectiveEnvironment: ErpBcEnvironment;
  /** Global toggle value (System Admin only sees Sandbox when set). */
  globalEnvironment: ErpBcEnvironment;
  canUseSandbox: boolean;
  canConfigure: boolean;
  /** True when current host allows UAT (localhost:3020). */
  sandboxHostAllowed: boolean;
}

export function erpEnvironmentLabel(env: ErpBcEnvironment): string {
  return env === "Sandbox" ? "UAT (Sandbox)" : "Production";
}

export function erpEnvironmentShortLabel(env: ErpBcEnvironment): string {
  return env === "Sandbox" ? "UAT" : "PROD";
}
