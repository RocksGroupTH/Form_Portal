import { BRANDS } from "@/lib/brand";

/** Brands with BC profile in Settings → Brand Config (PCTH, KSI, PCMY, UNO). */
export const ERP_INTERFACE_BRANDS = BRANDS.filter((b) => b.enabled);

export function isErpInterfaceBrandCode(brandCode: string): boolean {
  return ERP_INTERFACE_BRANDS.some((b) => b.id === brandCode.trim().toUpperCase());
}
