export type ErpBcEnvironment = "Production" | "Sandbox";

/** Hosts where UAT/Sandbox may be enabled (local dev only). */
export const ERP_SANDBOX_ALLOWED_HOSTS = ["localhost:3081", "127.0.0.1:3081"] as const;

export function isErpSandboxHostAllowed(host?: string | null): boolean {
  const h = (host ?? "").toLowerCase().trim();
  return (ERP_SANDBOX_ALLOWED_HOSTS as readonly string[]).includes(h);
}

export interface ErpEnvironmentInfo {
  /**
   * Which Business Central instance this route targets. Follows the form's
   * Form Environment flag — there is no per-user or per-host component to it
   * any more, so there is nothing else to report.
   */
  effectiveEnvironment: ErpBcEnvironment;
}

export function erpEnvironmentLabel(env: ErpBcEnvironment): string {
  return env === "Sandbox" ? "UAT (Sandbox)" : "Production";
}

export function erpEnvironmentShortLabel(env: ErpBcEnvironment): string {
  return env === "Sandbox" ? "UAT" : "PROD";
}
