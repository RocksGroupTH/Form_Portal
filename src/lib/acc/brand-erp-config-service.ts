import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import {
  ERP_INTERFACE_BRANDS,
  isErpInterfaceBrandCode,
} from "@/lib/acc/erp-interface-brands";
import {
  deleteBrandErpInterfaceMap,
  getBrandErpInterfaceMap,
  listBrandErpInterfaceMaps,
  upsertBrandErpInterfaceMap,
} from "@/lib/acc/brand-erp-interface-map-service";
import { getBrandConfig, listBrandConfigLookups, listBrandConfigs } from "@/lib/brand-config";
import type { BrandConfigPublic } from "@/lib/brand-config";

export interface ErpTargetBrandOption {
  brandCode: string;
  brandName: string;
  bcId: string | null;
  bcName: string | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
}

export interface BrandErpConfigRow {
  /** AP-1 claim brand (e.g. ROCKS, PCTH). */
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  /** Brand Config brand selected for ERP (e.g. PCTH). */
  interfaceBrandCode: string | null;
  interfaceBrandName: string | null;
  bcId: string | null;
  bcName: string | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
  interfaceMapped: boolean;
  bcProfileComplete: boolean;
  bcConfigComplete: boolean;
}

export interface BrandErpConfigPageData {
  brands: BrandErpConfigRow[];
  targetBrands: ErpTargetBrandOption[];
}

export interface ErpInterfaceBcProfile {
  interfaceBrandCode: string;
  claimBrandCode: string;
  bcId: string | null;
  bcName: string | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
}

function targetFromConfig(
  cfg: BrandConfigPublic,
  connById: Map<number, { code: string; name: string }>,
): ErpTargetBrandOption {
  const bcId = cfg.bcId ?? null;
  const bcName = cfg.bcName ?? null;
  const connId = cfg.bcConnectionId;
  const conn = connId != null && connId > 0 ? connById.get(Number(connId)) : undefined;
  return {
    brandCode: cfg.brandCode,
    brandName: cfg.brandName,
    bcId,
    bcName,
    bcConnectionCode: conn?.code ?? null,
    bcConnectionName: conn?.name ?? cfg.bcConnectionName,
    bcProfileComplete: !!(bcId?.trim() && bcName?.trim()),
  };
}

function toClaimRow(
  claim: { brandCode: string; brandName: string; brandLogo: string | null },
  interfaceBrandCode: string | null,
  targetByCode: Map<string, ErpTargetBrandOption>,
): BrandErpConfigRow {
  const target = interfaceBrandCode ? targetByCode.get(interfaceBrandCode.toUpperCase()) : undefined;
  const bcProfileComplete = target?.bcProfileComplete ?? false;
  const hasConnection = !!(
    target?.bcConnectionCode?.trim() || target?.bcConnectionName?.trim()
  );
  return {
    brandCode: claim.brandCode,
    brandName: claim.brandName,
    brandLogo: claim.brandLogo,
    interfaceBrandCode,
    interfaceBrandName: target?.brandName ?? null,
    bcId: target?.bcId ?? null,
    bcName: target?.bcName ?? null,
    bcConnectionCode: target?.bcConnectionCode ?? null,
    bcConnectionName: target?.bcConnectionName ?? null,
    interfaceMapped: !!interfaceBrandCode,
    bcProfileComplete,
    bcConfigComplete: !!interfaceBrandCode && bcProfileComplete && hasConnection,
  };
}

/** One row per AP-1 claimable brand; map each to a Brand Config target. */
export async function getBrandErpConfigPage(): Promise<BrandErpConfigPageData> {
  const [claimBrands, configs, ifaceMaps] = await Promise.all([
    getAllowedBrands(AP1_FORM_CODE),
    listBrandConfigs(0),
    listBrandErpInterfaceMaps(),
  ]);

  const connById = new Map<number, { code: string; name: string }>();
  const lookups = await listBrandConfigLookups();
  for (const c of lookups.bcConnections) {
    connById.set(c.id, { code: c.code, name: c.name });
  }

  const configByCode = new Map(
    configs.map((c) => [c.brandCode.toUpperCase(), c]),
  );
  const targetBrands = ERP_INTERFACE_BRANDS.map((b) => {
    const cfg = configByCode.get(b.id.toUpperCase());
    if (cfg) return targetFromConfig(cfg, connById);
    return {
      brandCode: b.id,
      brandName: b.name,
      bcId: null,
      bcName: null,
      bcConnectionCode: null,
      bcConnectionName: null,
      bcProfileComplete: false,
    };
  });

  const targetByCode = new Map(targetBrands.map((t) => [t.brandCode.toUpperCase(), t]));
  const mapByClaim = new Map(
    ifaceMaps.map((m) => [m.brandCode.toUpperCase(), m.interfaceBrandCode.toUpperCase()]),
  );

  const brands = claimBrands.map((claim) =>
    toClaimRow(
      claim,
      mapByClaim.get(claim.brandCode.toUpperCase()) ?? null,
      targetByCode,
    ),
  );

  return { brands, targetBrands };
}

export async function updateBrandErpInterfaceTarget(
  claimBrandCode: string,
  interfaceBrandCode: string,
  userId: number,
): Promise<BrandErpConfigRow | null> {
  const claim = claimBrandCode.trim().toUpperCase();
  const target = interfaceBrandCode.trim().toUpperCase();
  if (!isErpInterfaceBrandCode(target)) {
    throw new Error("แบรนด์ปลายทางต้องเป็น PCTH, KSI, PCMY หรือ UNO");
  }

  const allowed = await getAllowedBrands(AP1_FORM_CODE);
  const claimBrand = allowed.find((b) => b.brandCode.toUpperCase() === claim);
  if (!claimBrand) throw new Error("แบรนด์นี้ไม่ได้เปิดใช้ใน AP-1");

  await upsertBrandErpInterfaceMap(claim, target, userId);

  const page = await getBrandErpConfigPage();
  return page.brands.find((b) => b.brandCode.toUpperCase() === claim) ?? null;
}

export async function clearBrandErpInterfaceTarget(claimBrandCode: string): Promise<void> {
  const claim = claimBrandCode.trim().toUpperCase();
  const allowed = await getAllowedBrands(AP1_FORM_CODE);
  const claimBrand = allowed.find((b) => b.brandCode.toUpperCase() === claim);
  if (!claimBrand) throw new Error("แบรนด์นี้ไม่ได้เปิดใช้ใน AP-1");

  await deleteBrandErpInterfaceMap(claim);
}

async function resolveTargetBrandCode(claimBrandCode: string): Promise<string | null> {
  const row = await getBrandErpInterfaceMap(claimBrandCode);
  return row?.interfaceBrandCode ?? null;
}

/** BC company + Connect for ERP export from an AP-1 claim brand. */
export async function getErpInterfaceBcProfile(
  claimBrandCode: string,
): Promise<ErpInterfaceBcProfile | null> {
  const interfaceBrand = await resolveTargetBrandCode(claimBrandCode);
  if (!interfaceBrand) return null;

  const { listBrandConfigLookups } = await import("@/lib/brand-config");
  const [cfg, lookups] = await Promise.all([
    getBrandConfig(interfaceBrand),
    listBrandConfigLookups(),
  ]);
  if (!cfg) return null;

  const conn = cfg.bcConnectionId != null
    ? lookups.bcConnections.find((c) => c.id === cfg.bcConnectionId)
    : null;

  return {
    interfaceBrandCode: interfaceBrand,
    claimBrandCode: claimBrandCode.trim().toUpperCase(),
    bcId: cfg.bcId,
    bcName: cfg.bcName,
    bcConnectionCode: conn?.code ?? null,
    bcConnectionName: conn?.name ?? cfg.bcConnectionName,
  };
}

/** @deprecated Use getErpInterfaceBcProfile().bcConnectionCode */
export async function getInterfaceConnectCodeForBrand(
  claimBrandCode: string,
): Promise<string | null> {
  const profile = await getErpInterfaceBcProfile(claimBrandCode);
  return profile?.bcConnectionCode ?? null;
}
