"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RdAnswerState, RdVatRegistrant } from "@/lib/clr/rd-vat-core";

/* Kept in step with the button's rule by the compiler: `tinsNeedingRdCheck`
   decides what to ask about from `RdAnswerState`, and drifting the two apart
   would silently change what the button counts. */
type _StatesMatch = RdAnswer["state"] extends RdAnswerState
  ? RdAnswerState extends RdAnswer["state"] ? true : never
  : never;
const _statesMatch: _StatesMatch = true;
void _statesMatch;

export type RdAnswer =
  | { state: "checking" }
  | { state: "found"; registrant: RdVatRegistrant; checkedAt: string | null }
  | { state: "unregistered"; checkedAt: string | null }
  | { state: "unknown" };

/**
 * What the Revenue Department says about each tax id on the grid.
 *
 * Keyed by tax id, not by row. The card this replaces asked once per card and
 * deduped with a ref holding a single value, so six lines sharing a seller made
 * six HTTP calls for one answer — against a SOAP service behind a 15-second
 * timeout. Every one of those rows gets the same answer, so it is asked once.
 *
 * The automatic ask keeps the card's trigger rather than waiting for a click: a
 * stored answer never expires, so the ordinary case is a row read out of our
 * own table and making someone click for it bought nothing. `ask` is the manual
 * path — the button uses it for the ids with no answer yet, and a row's popover
 * uses it with `refresh` to overwrite one.
 */
export function useRdVatByTin(taxIds: readonly (string | null | undefined)[]) {
  const [byTin, setByTin] = useState<Record<string, RdAnswer>>({});
  const requested = useRef<Set<string>>(new Set());

  const ask = useCallback(async (tin: string, refresh = false) => {
    if (tin.length !== 13) return;
    requested.current.add(tin);
    setByTin((p) => ({ ...p, [tin]: { state: "checking" } }));
    try {
      const res = await fetch(
        `/api/request/clear-advance/vat-registrant?taxId=${tin}${refresh ? "&refresh=1" : ""}`,
      );
      const j = (await res.json()) as {
        ok: boolean;
        data?: { registrant: RdVatRegistrant | null; checkedAt: string | null };
      };
      if (!j.ok) {
        /* A failed ask has to stay askable. Marking it requested and leaving it
           there is how a transient outage becomes a permanent blank — the same
           shape as the bug already fixed in useGlOptionsByBranch. The button
           counts `unknown`, so this is what lets it be retried. */
        requested.current.delete(tin);
        setByTin((p) => ({ ...p, [tin]: { state: "unknown" } }));
        return;
      }
      const checkedAt = j.data?.checkedAt ?? null;
      setByTin((p) => ({
        ...p,
        [tin]: j.data?.registrant
          ? { state: "found", registrant: j.data.registrant, checkedAt }
          : { state: "unregistered", checkedAt },
      }));
    } catch {
      requested.current.delete(tin);
      setByTin((p) => ({ ...p, [tin]: { state: "unknown" } }));
    }
  }, []);

  // Join to a string so the effect follows the set of ids, not the new array
  // identity every render of the grid produces.
  const key = useMemo(
    () =>
      Array.from(
        new Set(taxIds.map((t) => (t ?? "").replace(/\D/g, "")).filter((t) => t.length === 13)),
      )
        .sort()
        .join("|"),
    [taxIds],
  );

  useEffect(() => {
    for (const tin of key ? key.split("|") : []) {
      if (requested.current.has(tin)) continue;
      void ask(tin);
    }
  }, [key, ask]);

  return { byTin, ask };
}
