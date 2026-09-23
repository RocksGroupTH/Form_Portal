import { getCorePool } from "@/lib/db/mssql";
import { listBrandRegistry } from "@/lib/brand-registry";

/**
 * **Brands with a complete Business Central profile** — the set a claim may be
 * interfaced INTO, and the one every Interface ERP screen groups by.
 *
 * ## It used to be four literals, and that is the whole history of this file
 *
 * This module was `BRANDS.filter((b) => b.enabled)` — the four hardcoded in
 * `@/lib/brand`. That list stopped being the registry when `BrandSetting`
 * shipped, and `brand.ts`'s docblock has said so ever since, while naming this
 * module as one of two things the literal still legitimately served: *"brands
 * with a complete BC profile, **not** brands this app offers. Those are
 * different questions and only look alike because the answer was the same
 * four."*
 *
 * It stayed true until somebody configured a fifth. Measured 2026-09-23: the
 * company master holds **seven** active brands and exactly four carry a `BcId`
 * — so the literal was right by coincidence, and an admin filling in SANMAI's
 * Config BC had no way to make it an interface target, nor any row to give it
 * a UAT company on Settings → ERP Interface Environment.
 *
 * **So the question is answered rather than listed.** A brand is an interface
 * brand when its `Fast_Core.dbo.BrandConfig` row carries both a BC company id
 * and a BC connection — which is exactly what "a complete BC profile" means,
 * and exactly what the Brand Configuration card already labels `Complete`.
 *
 * ## What this deliberately is NOT keyed on
 *
 * **Not `BrandSetting.IsEnabled`**, the switch that decides whether users may
 * pick a brand. `brand.ts` names that hazard precisely — *"wiring it to the
 * switch would make a brand an ERP posting target the moment somebody enabled
 * it, with no BC configuration behind it"* — and it is still the hazard: the
 * two questions are "may somebody file against this brand" and "may money be
 * posted into this company's books", and the second must follow the BC
 * configuration rather than a visibility toggle. Measured the same day, every
 * `BrandSetting` row in production reads `IsEnabled = 0`, so keying on it would
 * have emptied every Interface ERP screen in the app.
 *
 * **Not the master alone** either. A brand exists long before anybody has told
 * this app which BC company it posts into, and offering it as a target in that
 * state produces a journal with nowhere to go.
 *
 * ## Async, and that is the cost the user accepted
 *
 * The four client components that list interface brands cannot import this —
 * it reaches a pool, and `@/env` validates the whole environment at import.
 * They read `GET /api/brands/erp-interface` through `useErpInterfaceBrands()`
 * instead. Anything server-side calls these two directly.
 */

/** A brand this app may interface a claim into. */
export interface ErpInterfaceBrand {
  id: string;
  name: string;
  /**
   * What to put in an `<img>`, or null — the registry's own answer, which
   * prefers a logo an admin uploaded over the `/brandlogo/{code}-200.png`
   * convention. Carried here because three of the screens that list these
   * brands render it, and rebuilding the path from the code would quietly
   * drop every uploaded logo.
   */
  logo: string | null;
}

/**
 * The interface brands, in the master's own order.
 *
 * **The master decides membership as well as the name.** The join runs from
 * `listBrandRegistry()`, so a `BrandConfig` row for a code the master does not
 * carry is inert rather than a phantom target — the same rule
 * `brand-registry.ts` states for `BrandSetting`, and not a theoretical one:
 * measured 2026-09-23, `BrandConfig` holds `PAL`, `PL`, `SAN` and `SM`, none of
 * which the master has.
 *
 * A brand switched off in `BrandSetting` is still here, deliberately — see the
 * docblock above. `isEnabled` decides who may file, not where money posts.
 */
export async function listErpInterfaceBrands(): Promise<ErpInterfaceBrand[]> {
  const [pool, registry] = await Promise.all([getCorePool(), listBrandRegistry()]);

  /* Both halves of "complete", and each is checked the way the column can
     actually be empty: `BcId` is nvarchar and an unconfigured row holds NULL
     or a blank string, while `BcConnectionId` is an int whose unset value is
     NULL — and `> 0` beside it, because `DbConnection` ids are positive and a
     0 would be a row nothing can resolve. This is the same pair the Brand
     Configuration card reads to print `Complete`. */
  const res = await pool.request().query(`
    SELECT BrandCode
    FROM [dbo].[BrandConfig] WITH (NOLOCK)
    WHERE BcId IS NOT NULL
      AND LTRIM(RTRIM(BcId)) <> ''
      AND BcConnectionId IS NOT NULL
      AND BcConnectionId > 0
  `);

  const complete = new Set<string>();
  for (const r of res.recordset as Record<string, unknown>[]) {
    const code = String(r.BrandCode ?? "").trim().toUpperCase();
    if (code) complete.add(code);
  }

  return registry
    .filter((b) => complete.has(b.code.trim().toUpperCase()))
    .map((b) => ({ id: b.code, name: b.name, logo: b.logo }));
}

/**
 * Is this code one this app may interface into?
 *
 * Nine call sites validate a posted Company / target code with it, so it has
 * to refuse a brand with no BC profile rather than merely not listing it —
 * filtering a picker is not a control, and these codes arrive in request
 * bodies.
 *
 * A blank or unknown code is false, which is the fail-safe direction: the
 * caller answers 400 rather than writing a mapping to a company that has no
 * connection behind it.
 *
 * ## It is DELIBERATELY not called `isErpInterfaceBrandCode` any more
 *
 * That was the synchronous name, and three of its call sites used the result
 * as a bare boolean:
 *
 * ```
 * .filter((c) => isErpInterfaceBrandCode(c))       // approvers/route.ts
 * if (isErpInterfaceBrandCode(c)) set.add(c);       // approver-interface-access.ts
 * if (isErpInterfaceBrandCode(code)) return;        // brand-journal-batch-service.ts
 * ```
 *
 * **A promise is always truthy**, so keeping the name while making it async
 * would have left all three compiling, passing every test, and silently
 * admitting every code — on an approver's brand scope, on the codes written to
 * `AccApproverInterfaceBrand`, and on the guard that decides whether a journal
 * batch's brand needs checking against AP-1's allow-list. TypeScript does not
 * catch it: `Array.filter` takes a predicate returning `unknown`, and an `if`
 * takes anything.
 *
 * Renaming turns all nine of those into compile errors, which is the only
 * reason this conversion is safe to make at all. **If it is ever renamed back,
 * or a synchronous shim is added beside it, that protection is gone** — and
 * `erp-interface-brand-source-guard.test.ts` is what notices.
 */
export async function isErpInterfaceBrand(brandCode: string): Promise<boolean> {
  const code = brandCode.trim().toUpperCase();
  if (!code) return false;
  const brands = await listErpInterfaceBrands();
  return brands.some((b) => b.id.trim().toUpperCase() === code);
}
