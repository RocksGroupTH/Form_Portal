"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GlAccountOption } from "@/features/clear-advance/types";

/**
 * The AP-3 account list for every branch a set of lines currently uses.
 *
 * The server decides which accounts a branch may charge — `listGlAccounts`
 * filters by DimensionType — so nothing is filtered here. This only fetches
 * each distinct branch once and remembers the answer; a failed fetch forgets
 * the branch so a later render retries it.
 *
 * It lived inline in ClearAdvanceForm while the requester picked the account.
 * The account officer picks it now, on a different grid, and the two would
 * otherwise each carry a copy of the same cache.
 */
export function useGlOptionsByBranch(
  branchCodes: readonly (string | null | undefined)[],
): Record<string, GlAccountOption[]> {
  const [byBranch, setByBranch] = useState<Record<string, GlAccountOption[]>>({});
  const requested = useRef<Set<string>>(new Set());

  // Join to a string so the effect re-runs on the set of branches, not on the
  // new array identity every render produces.
  const key = useMemo(
    () => Array.from(new Set(branchCodes.filter(Boolean) as string[])).sort().join("|"),
    [branchCodes],
  );

  useEffect(() => {
    const missing = (key ? key.split("|") : []).filter((c) => !requested.current.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => requested.current.add(c));
    let cancelled = false;
    Promise.all(
      missing.map((code) =>
        fetch(`/api/request/clear-advance/options/gl-accounts?branch=${encodeURIComponent(code)}`)
          .then((r) => r.json())
          .then((j: { ok: boolean; data?: GlAccountOption[] }) => [code, j.ok ? j.data ?? [] : []] as const)
          .catch(() => {
            requested.current.delete(code); // let a later render retry
            return [code, [] as GlAccountOption[]] as const;
          }),
      ),
    ).then((entries) => {
      if (!cancelled) setByBranch((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [key]);

  return byBranch;
}

/**
 * Options for one line, keeping a stored account visible even when the current
 * branch filter would no longer offer it.
 *
 * A historical account, or one since deactivated in the master, must still
 * render — dropping it would leave the cell reading as "not chosen" for a line
 * that is in fact accounted for. The `dimensionType` on the synthetic entry is
 * display-only; nothing validates against it.
 */
export function glOptionsForLine(
  byBranch: Record<string, GlAccountOption[]>,
  line: { branchCode?: string | null; glAccountNo?: string | null; glAccountName?: string | null },
): GlAccountOption[] {
  const opts = (line.branchCode && byBranch[line.branchCode]) || [];
  if (!line.glAccountNo || opts.some((o) => o.glAccountNo === line.glAccountNo)) return opts;
  return [
    { glAccountNo: line.glAccountNo, nameTh: line.glAccountName || null, nameEn: null, dimensionType: "Employee" },
    ...opts,
  ];
}
