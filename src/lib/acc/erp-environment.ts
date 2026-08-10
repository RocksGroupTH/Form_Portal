import { getAppSetting, setAppSetting } from "@/lib/app-settings";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
import {
  erpEnvironmentLabel,
  isErpSandboxHostAllowed,
} from "@/lib/acc/erp-environment-shared";
import { isSystemAdminRole } from "@/lib/roles";
import { headers } from "next/headers";

export type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
export { erpEnvironmentLabel, isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";
const VALID_ENVIRONMENTS: ErpBcEnvironment[] = ["Production", "Sandbox"];

export function normalizeErpBcEnvironment(raw: string | null | undefined): ErpBcEnvironment {
  const v = (raw ?? "").trim();
  if (v === "Sandbox") return "Sandbox";
  return "Production";
}

/** Global setting (System Admin only to change). Defaults to Production. */
export async function getGlobalErpInterfaceEnvironment(): Promise<ErpBcEnvironment> {
  const raw = await getAppSetting(ERP_INTERFACE_ENV_KEY);
  return normalizeErpBcEnvironment(raw);
}

export async function setGlobalErpInterfaceEnvironment(
  env: ErpBcEnvironment,
  userId: number,
  host?: string | null,
): Promise<void> {
  if (!VALID_ENVIRONMENTS.includes(env)) {
    throw new Error("Invalid ERP interface environment");
  }
  if (env === "Sandbox" && !isErpSandboxHostAllowed(host)) {
    throw new Error("UAT/Sandbox ใช้ได้เฉพาะบน localhost:3020 เท่านั้น");
  }
  await setAppSetting(ERP_INTERFACE_ENV_KEY, env, userId);
}

/** System Admin on an allowed dev host may use Sandbox. */
export function canUseErpSandboxEnvironment(
  role: string | null | undefined,
  host?: string | null,
): boolean {
  return isErpSandboxHostAllowed(host) && isSystemAdminRole(role);
}

export async function getRequestHost(): Promise<string | null> {
  const h = await headers();
  return h.get("host");
}

/**
 * Effective environment for the current user.
 * Sandbox only on localhost:3020 + System Admin; all other hosts → Production.
 */
export async function resolveEffectiveErpEnvironment(
  role: string | null | undefined,
  host?: string | null,
): Promise<ErpBcEnvironment> {
  if (!canUseErpSandboxEnvironment(role, host)) return "Production";
  return getGlobalErpInterfaceEnvironment();
}

export const ERP_INTERFACE_ENV_KEY = "ERP_INTERFACE_ENV";