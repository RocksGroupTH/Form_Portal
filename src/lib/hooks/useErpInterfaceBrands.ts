"use client";

import useSWR from "swr";

/** A brand this app may interface a claim into. Mirrors `ErpInterfaceBrand`. */
export interface ErpInterfaceBrandOption {
  id: string;
  name: string;
  logo: string | null;
}

/**
 * The empty answer, as ONE array that never changes identity.
 *
 * `return { brands: data ?? [] }` allocates a fresh array on **every render**
 * while `data` is undefined — which is every render until the fetch lands, and
 * every render for ever if it fails. Thirteen call sites put this value in a
 * dependency array, and in `ApproverInterfaceBrandTable` it reaches a
 * `useEffect` that calls `setChecked`: new array → new `allIds` memo → effect
 * runs → state set → render → new array. That is an infinite loop, and it is
 * what AP-1's สิทธิ์เข้าถึง tab threw on 2026-09-24 — *"Maximum update depth
 * exceeded"*, on every load.
 *
 * **It is a regression from the 2026-09-23 conversion**, not an old bug:
 * `ERP_INTERFACE_BRANDS` was a module constant, so its identity was stable by
 * construction and no consumer had to think about it. Replacing a constant
 * with a hook silently withdrew that guarantee from all thirteen.
 *
 * Frozen because it is now shared by every caller and every render: a single
 * `brands.push(...)` anywhere would be seen by all of them at once.
 */
const NO_BRANDS: ErpInterfaceBrandOption[] = [];
Object.freeze(NO_BRANDS);

const fetcher = async (url: string): Promise<ErpInterfaceBrandOption[]> => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    throw new Error((json && json.error) || `HTTP ${res.status}`);
  }
  return (json.data ?? []) as ErpInterfaceBrandOption[];
};

/**
 * The brands with a complete Business Central profile, for the fourteen client
 * components that used to import `ERP_INTERFACE_BRANDS` as a module constant.
 *
 * ## Why a hook rather than the constant it replaces
 *
 * The list is now derived from `BrandConfig` (see `erp-interface-brands.ts`),
 * so it needs a pool, and `@/env` validates the whole environment at import —
 * a client component importing it breaks the build, which is the trap
 * `api-keys/codes.ts` already records for `TESTABLE_CODES`. One hook and one
 * SWR key means one request per page rather than fourteen, and one cache entry
 * they all agree on.
 *
 * ## `brands` is `[]` while loading AND on failure — read `ready` before
 * concluding anything from it
 *
 * Every caller renders a list, and an empty list renders as "no groups", which
 * is indistinguishable from "nothing is configured". That is a real state here
 * — a deployment where nobody has filled in a Config BC genuinely has none —
 * so the two cannot be told apart from the array alone.
 *
 * Callers that only map over it may ignore `ready`: rendering nothing for a
 * moment is what they did before while their own data loaded. Callers that say
 * something *about* the emptiness — a commissioning banner, a "not
 * configured" line, a count out of a total — must gate on it, the same rule
 * AP-4's approver banners and AP-17's settings banner already follow: not
 * measured yet must not render as measured and empty.
 *
 * ## It never falls back to the old four
 *
 * A stale literal behind a failed fetch would put PCTH, KSI, PCMY and UNO on
 * screen on a deployment that has since configured others, or dropped one —
 * and on the settings screens that would invite somebody to save a mapping
 * against a company whose configuration this app can no longer see. Answering
 * nothing is the honest failure.
 */
export function useErpInterfaceBrands(): {
  brands: ErpInterfaceBrandOption[];
  ready: boolean;
  error: unknown;
} {
  const { data, error } = useSWR<ErpInterfaceBrandOption[]>(
    "/api/brands/erp-interface",
    fetcher,
    // The set changes when an admin finishes a brand's Config BC, which is
    // rare and is a different screen from every consumer of this hook. Revalidate
    // on focus so that admin's other tab catches up without a reload, and not
    // on an interval.
    { revalidateOnFocus: true, revalidateIfStale: true },
  );
  /* `NO_BRANDS`, never a fresh `[]` — see its own note. An unstable identity
     here is invisible to the typechecker and to every test in this repo, and
     it reaches a `setState` in an effect two components away. */
  return { brands: data ?? NO_BRANDS, ready: data !== undefined, error };
}

/** The codes alone, which is what most callers actually want. */
export function erpInterfaceBrandCodes(brands: ErpInterfaceBrandOption[]): string[] {
  return brands.map((b) => b.id);
}
