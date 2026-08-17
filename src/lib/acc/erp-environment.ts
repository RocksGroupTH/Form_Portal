import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
import { headers } from "next/headers";
import { resolveFormEnvironment } from "@/lib/form-environment";

export type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
export { erpEnvironmentLabel, isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";

export async function getRequestHost(): Promise<string | null> {
  const h = await headers();
  return h.get("host");
}

/**
 * Which Business Central instance this request targets.
 *
 * One switch decides it: the form's own environment. A form flagged UAT at
 * Settings → Form Environment reads and writes the UAT database, and its
 * journals go to BC Sandbox. There is deliberately no separate ERP toggle —
 * two switches sharing the word "UAT" is how a test request ends up in the
 * real ERP.
 *
 * Code with no request scope — scripts, the background email drain — resolves
 * to Production, exactly as its database does.
 */
export async function resolveEffectiveErpEnvironment(): Promise<ErpBcEnvironment> {
  const formEnvironment = await resolveFormEnvironment();
  return formEnvironment === "UAT" ? "Sandbox" : "Production";
}
