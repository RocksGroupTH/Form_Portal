/**
 * The brand cookie, and what is left of the old hardcoded registry.
 *
 * **This is no longer the list of brands.** `src/lib/brand-registry.ts` is —
 * the company brand master joined with `BrandSetting` — and `/api/brands` is
 * what `BrandProvider`, `BrandGate` and `BrandSwitcher` read. `BRANDS` below
 * survives for two things only:
 *
 * - `erp-interface-brands.ts`, whose meaning is "brands with a complete BC
 *   profile", **not** "brands this app offers". Those are different questions
 *   and only look alike because the answer was the same four. Wiring it to the
 *   switch would make a brand an ERP posting target the moment somebody enabled
 *   it, with no BC configuration behind it.
 * - `getBrandDashboardReadiness` in `brand-config.ts`, which is dead code kept
 *   for the Rocks Fast sibling.
 *
 * Adding a brand here does **not** put it in the picker, and a brand in the
 * picker need not be here.
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

/**
 * Whether a cookie value is shaped like a brand code.
 *
 * **A shape check, not a membership check, and that is the point.** It runs in
 * the root layout, which is synchronous and must not open a database
 * connection to decide what to hand `BrandProvider` as its initial value. It
 * used to test membership of the hardcoded four, so a cookie holding a brand
 * added to the master resolved to null and reopened the picker on every single
 * page load.
 *
 * `BrandGate` is the real gate: it compares the cookie against the list it
 * fetched from `/api/brands` and reopens if the brand is not offered. Every
 * server route that acts on a brand re-checks it against the master anyway, so
 * nothing is decided by this function — it only avoids a pointless modal.
 */
export function isValidBrand(id: string | null | undefined): boolean {
  if (!id) return false;
  const code = id.trim();
  return code.length > 0 && code.length <= 40 && /^[A-Za-z0-9_-]+$/.test(code);
}
