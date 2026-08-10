/**
 * Brand registry — shared between server (middleware, RootLayout cookie read)
 * and client (BrandProvider, BrandSwitcher, BrandGate).
 *
 * NOTE: keep in sync with the BrandConfig rows in Fast_Core — a brand listed
 * here with no BrandConfig row cannot resolve an ERP connection.
 */

export const BRAND_COOKIE = "rocks-fast-brand";
export const BRAND_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export interface Brand {
  id: string;
  name: string;
  logo: string;
  enabled: boolean;
}

export const BRANDS: Brand[] = [
  { id: "PCTH", name: "PCTH", logo: "/brandlogo/pcth.png", enabled: true },
  { id: "KSI",  name: "KSI",  logo: "/brandlogo/ksi.png",  enabled: true },
  { id: "PCMY", name: "PCMY", logo: "/brandlogo/pcmy.png", enabled: true },
  { id: "UNO",  name: "UNO",  logo: "/brandlogo/uno.png",  enabled: true },
];

export function getBrandById(id: string | null | undefined): Brand | undefined {
  if (!id) return undefined;
  return BRANDS.find((b) => b.id === id);
}

export function isValidBrand(id: string | null | undefined): boolean {
  const b = getBrandById(id);
  return !!b && b.enabled;
}
