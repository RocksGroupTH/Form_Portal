"use server";

import { cookies } from "next/headers";
import { BRAND_COOKIE, BRAND_COOKIE_MAX_AGE, isValidBrand } from "./brand";

export async function setBrandCookieAction(brandId: string): Promise<void> {
  if (!isValidBrand(brandId)) {
    throw new Error(`Invalid or disabled brand: ${brandId}`);
  }
  const c = await cookies();
  c.set(BRAND_COOKIE, brandId, {
    maxAge: BRAND_COOKIE_MAX_AGE,
    sameSite: "lax",
    path: "/",
  });
}

export async function clearBrandCookieAction(): Promise<void> {
  const c = await cookies();
  c.delete(BRAND_COOKIE);
}
