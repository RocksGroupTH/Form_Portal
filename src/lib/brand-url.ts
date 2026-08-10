import { isValidBrand } from "@/lib/brand";

export function getBrandFromSearchParams(sp: URLSearchParams): string | null {
  const b = sp.get("brand");
  return isValidBrand(b) ? b : null;
}

export function setBrandInSearchParams(sp: URLSearchParams, brandId: string): URLSearchParams {
  const next = new URLSearchParams(sp);
  next.set("brand", brandId);
  return next;
}

export function replaceSearchParams(pathname: string, sp: URLSearchParams): string {
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

