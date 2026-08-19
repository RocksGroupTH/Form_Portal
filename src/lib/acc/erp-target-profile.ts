import { getBrandErpConfigPage } from "@/lib/acc/brand-erp-config-service";
import {
  type ErpBcEnvironment,
  resolveEffectiveErpEnvironment,
} from "@/lib/acc/erp-environment";
import { ERP_INTERFACE_BRANDS, isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import { listErpTargetSettings } from "@/lib/acc/erp-target-setting-service";
import { getBcConnectionById } from "@/lib/bc/bc-connection";
import { getBrandConfig } from "@/lib/brand-config";

export interface ErpTargetProfile {
  interfaceBrandCode: string;
  environment: ErpBcEnvironment;
  bcId: string | null;
  bcName: string | null;
  bcConnectionId: number | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
  baseUrl: string | null;
  profileComplete: boolean;
}

type BrandConfigRow = Awaited<ReturnType<typeof getBrandConfig>>;
type ErpConfigPage = Awaited<ReturnType<typeof getBrandErpConfigPage>>;
type TargetSettingRow = Awaited<ReturnType<typeof listErpTargetSettings>>[number];
type BcConnectionRow = NonNullable<Awaited<ReturnType<typeof getBcConnectionById>>>;

function buildErpTargetProfile(
  interfaceBrandCode: string,
  environment: ErpBcEnvironment,
  erpPage: ErpConfigPage,
  targetSettings: TargetSettingRow[],
  cfg: BrandConfigRow,
  connById: Map<number, BcConnectionRow>,
): ErpTargetProfile | null {
  const code = interfaceBrandCode.trim().toUpperCase();
  if (!isErpInterfaceBrandCode(code)) return null;

  const prodTarget = erpPage.targetBrands.find((t) => t.brandCode.toUpperCase() === code);
  const uatRow = targetSettings.find((t) => t.brandCode === code);

  if (environment === "Production") {
    const conn = cfg?.bcConnectionId ? connById.get(cfg.bcConnectionId) ?? null : null;
    return {
      interfaceBrandCode: code,
      environment,
      bcId: cfg?.bcId ?? prodTarget?.bcId ?? null,
      bcName: cfg?.bcName ?? prodTarget?.bcName ?? null,
      bcConnectionId: cfg?.bcConnectionId ?? null,
      bcConnectionCode: conn?.Code ?? prodTarget?.bcConnectionCode ?? null,
      bcConnectionName: conn?.Name ?? prodTarget?.bcConnectionName ?? null,
      baseUrl: conn?.BaseUrl ?? null,
      profileComplete: !!(cfg?.bcId?.trim() && cfg?.bcName?.trim() && cfg?.bcConnectionId),
    };
  }

  let bcConnectionId = uatRow?.bcUatConnectionId ?? null;
  let bcConnectionCode: string | null = null;
  let bcConnectionName: string | null = null;
  let baseUrl: string | null = null;

  if (bcConnectionId) {
    const conn = connById.get(bcConnectionId) ?? null;
    if (conn) {
      bcConnectionCode = conn.Code;
      bcConnectionName = conn.Name;
      baseUrl = conn.BaseUrl;
    }
  } else if (cfg?.bcConnectionId) {
    bcConnectionId = cfg.bcConnectionId;
    const conn = connById.get(cfg.bcConnectionId) ?? null;
    if (conn) {
      bcConnectionCode = conn.Code;
      bcConnectionName = conn.Name;
      baseUrl = conn.BaseUrl;
    }
  }

  const bcId = uatRow?.bcUatId?.trim() || null;
  const bcName = uatRow?.bcUatName?.trim() || null;

  return {
    interfaceBrandCode: code,
    environment,
    bcId,
    bcName,
    bcConnectionId,
    bcConnectionCode,
    bcConnectionName,
    baseUrl,
    profileComplete: !!(bcId && bcName && bcConnectionId),
  };
}

function collectConnectionIds(
  brandIds: string[],
  configs: BrandConfigRow[],
  targetSettings: TargetSettingRow[],
  environment: ErpBcEnvironment,
): number[] {
  const connIds = new Set<number>();
  for (let i = 0; i < brandIds.length; i++) {
    const cfg = configs[i];
    const uat = targetSettings.find((t) => t.brandCode === brandIds[i]);
    if (environment === "Production") {
      if (cfg?.bcConnectionId) connIds.add(cfg.bcConnectionId);
    } else if (uat?.bcUatConnectionId) {
      connIds.add(uat.bcUatConnectionId);
    } else if (cfg?.bcConnectionId) {
      connIds.add(cfg.bcConnectionId);
    }
  }
  return Array.from(connIds);
}

export async function resolveErpTargetProfile(
  interfaceBrandCode: string,
  environmentOverride?: ErpBcEnvironment,
): Promise<ErpTargetProfile | null> {
  const code = interfaceBrandCode.trim().toUpperCase();
  if (!isErpInterfaceBrandCode(code)) return null;

  // Callers on a route that doesn't classify to the target form (e.g. a settings
  // route → Production) can pass the form's real environment explicitly.
  const environment = environmentOverride ?? await resolveEffectiveErpEnvironment();
  const [erpPage, targetSettings, cfg] = await Promise.all([
    getBrandErpConfigPage(),
    listErpTargetSettings(),
    getBrandConfig(code),
  ]);

  const connIds = collectConnectionIds([code], [cfg], targetSettings, environment);
  const connResults = await Promise.all(connIds.map((id) => getBcConnectionById(id)));
  const connById = new Map<number, BcConnectionRow>();
  for (const c of connResults) {
    if (c) connById.set(c.Id, c);
  }

  return buildErpTargetProfile(code, environment, erpPage, targetSettings, cfg, connById);
}

export async function resolveAllErpTargetProfiles(): Promise<ErpTargetProfile[]> {
  const brandIds = ERP_INTERFACE_BRANDS.map((b) => b.id);
  const environment = await resolveEffectiveErpEnvironment();

  const [erpPage, targetSettings, ...configs] = await Promise.all([
    getBrandErpConfigPage(),
    listErpTargetSettings(),
    ...brandIds.map((id) => getBrandConfig(id)),
  ]);

  const connIds = collectConnectionIds(brandIds, configs, targetSettings, environment);
  const connResults = await Promise.all(connIds.map((id) => getBcConnectionById(id)));
  const connById = new Map<number, BcConnectionRow>();
  for (const c of connResults) {
    if (c) connById.set(c.Id, c);
  }

  const profiles: ErpTargetProfile[] = [];
  for (let i = 0; i < brandIds.length; i++) {
    const p = buildErpTargetProfile(
      brandIds[i],
      environment,
      erpPage,
      targetSettings,
      configs[i],
      connById,
    );
    if (p) profiles.push(p);
  }
  return profiles;
}

export function formatErpTargetProfileMeta(profile: ErpTargetProfile): string {
  const parts = [
    profile.environment === "Sandbox" ? "UAT" : "PROD",
    profile.bcName?.trim(),
    profile.bcConnectionCode?.trim(),
    profile.bcId?.trim(),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
