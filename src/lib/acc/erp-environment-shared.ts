export type ErpBcEnvironment = "Production" | "Sandbox";

/** Hosts where UAT/Sandbox may be enabled (local dev only). */
/**
 * Dev hosts where the `devHostOnly` management cards and the manager-approval
 * dev bypass are offered.
 *
 * Both ports are listed on purpose. 3081 is what `package.json` and
 * `ecosystem.config.cjs` run today — the app was moved off 3020 so it stops
 * colliding with the Rocks Fast sibling, which owns that port. 3020 stays here
 * because a dev machine may still be serving this app there, and a management
 * card that silently disappears reads as a missing feature rather than a host
 * gate. Listing a port that nothing is serving costs nothing: the check is on
 * the request's own Host header, so an unused port is simply never matched.
 */
export const ERP_SANDBOX_ALLOWED_HOSTS = [
  "localhost:3081",
  "127.0.0.1:3081",
  "localhost:3020",
  "127.0.0.1:3020",
] as const;

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
