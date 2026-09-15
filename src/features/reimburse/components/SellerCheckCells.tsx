"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  TAX_ID_LENGTH,
  compareVendorName,
  registrantDisplayName,
  taxIdDigits,
  taxIdProblem,
  type RegistrantName,
} from "@/features/reimburse/lib/vendor-check";

/** What the RD lookup answers — only the parts this cell reads. */
interface Registrant extends RegistrantName {
  branchCode: string | null;
  address: string | null;
}

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  /** On the register. `replaced` is true when the lookup overwrote a name
   *  somebody had already typed, which is the only case worth a line on
   *  screen — an empty box being filled speaks for itself. */
  | { kind: "found"; registrant: Registrant; replaced: boolean }
  /** A valid number the register does not hold — an ordinary fact about a small seller. */
  | { kind: "absent" }
  /** The RD could not be reached. Never rendered as "not registered". */
  | { kind: "unavailable" };

/**
 * เลขผู้เสียภาษี and ผู้ขาย, checked against the Revenue Department.
 *
 * The two cells are one component because they answer one question between
 * them: the number is looked up and the NAME is what the answer is about, so
 * splitting them would mean lifting the lookup into the grid and passing its
 * state back down to two siblings.
 *
 * **The check fires when the number reaches 13 digits**, not on a button. A
 * number is either complete or it is not — there is no half-typed tax id worth
 * asking about — so a button would be a click that adds nothing, and the one
 * person who would forget to press it is the one filling the form in a hurry.
 *
 * Three answers, three different things on screen, and telling them apart is
 * the point:
 *
 * - **found and the name agrees** — a quiet tick. Nothing to do.
 * - **found and the name does not** — two things, and they are not alternatives
 *   (user, 2026-09-15, in two passes):
 *
 *   **The registered name replaces what was typed on the FIRST find**, with a
 *   line saying it did. That is the receipt-read case: attaching the file fills
 *   the tax id and a seller name together, the read's name is a transcription
 *   of a photograph and the register's is the one the ledger wants. This used
 *   to be an offer on a yellow button and nothing else, on the reasoning that a
 *   receipt can print a trading name the register has never heard of and a
 *   fuzzy comparison should not overwrite a person; the user overruled that.
 *   **Changing the tax id afterwards does not replace anything** — by then the
 *   row is being worked on deliberately, and the button is the whole answer.
 *
 *   **The offer stands whenever the box disagrees with the register** — a name
 *   edited after the replacement, a saved row opened with a name that never
 *   matched, or the row the auto-replace deliberately skips. One condition,
 *   `offerAvailable`, because "does not match" and "was edited away from a
 *   match" are the same thing to look at. So the box is an ordinary input after
 *   the replacement, and the way back is one click rather than retyping a
 *   company name.
 * - **not on the register** — a line saying so, and explicitly saying the value
 *   is still usable. Small sellers are not VAT registered; that is a fact about
 *   the receipt, not a fault in the row.
 *
 * An RD outage is its own state and says "could not check", because rendering it
 * as "not registered" would be a claim about the seller that nobody verified.
 *
 * A wrong-length number gets a red border and blocks submit — that rule lives in
 * `vendor-check.ts` with the grid's other validation, not here.
 */
export function SellerCheckCells({
  index,
  taxId,
  vendorName,
  onChange,
}: {
  index: number;
  taxId: string | null | undefined;
  vendorName: string | null | undefined;
  onChange: (patch: { vendorTaxId?: string | null; vendorName?: string | null }) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  /* Read by the lookup when it lands, so it sees what is in the box THEN
     rather than what was there when the tax id changed. Assigned on every
     render rather than in an effect: an effect would run after the fetch had
     already been started and read. */
  const nameRef = useRef(vendorName);
  nameRef.current = vendorName;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const digits = taxIdDigits(taxId);
  /**
   * Did this row arrive with a tax id already on it?
   *
   * **A saved row is looked up but never overwritten.** The lookup fires
   * whenever the number is 13 digits long, mount included, so without this
   * reopening a draft would silently rewrite a seller name somebody had
   * deliberately corrected to the trading name on the receipt — replacing a
   * decision nobody was making at the time. Such a row gets the offer button
   * instead, which is the same answer every other disagreement gets.
   *
   * A value rather than a "first run" flag, so it is stable under
   * `reactStrictMode`'s mount → cleanup → mount.
   */
  const arrivedWithTaxIdRef = useRef(digits !== "");
  /**
   * Has a lookup on this row ever found a registrant?
   *
   * **The replacement happens on the FIRST find and never again** (user,
   * 2026-09-15). The case it is for is the receipt read: attaching the file
   * fills the tax id and a seller name in the same breath, the read's name is a
   * transcription of a photograph, and the register's is the one the ledger
   * wants — so it is taken outright rather than offered.
   *
   * **Changing the number afterwards is a different act**, and it gets the
   * button. By then somebody is working on the row deliberately, and a name
   * they typed is a decision; overwriting it on a number they are still editing
   * would fight them keystroke by keystroke, thirteen digits at a time.
   *
   * Set on the first find whether or not anything was written — a find whose
   * name already agreed still spends it. The event is "this row has been
   * identified", not "this row was corrected".
   */
  const foundOnceRef = useRef(false);
  const problem = taxIdProblem(taxId);

  useEffect(() => {
    if (digits.length !== TAX_ID_LENGTH) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "checking" });
    fetch(`/api/request/reimburse/vat-registrant?taxId=${encodeURIComponent(digits)}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { registrant: Registrant | null } }) => {
        if (cancelled) return;
        if (!json.ok) setState({ kind: "unavailable" });
        else if (json.data?.registrant) {
          const found = json.data.registrant;
          const name = registrantDisplayName(found);
          // `nameRef`, not the `vendorName` this closure captured: the effect
          // keys on the tax id alone, so by the time the lookup lands the name
          // may have been typed or changed. Comparing the stale copy would
          // report "replaced" for a row it did not touch, or stay quiet on one
          // it did.
          const had = (nameRef.current ?? "").trim();
          const firstFind = !foundOnceRef.current;
          if (name !== "") foundOnceRef.current = true;
          const shouldWrite =
            !arrivedWithTaxIdRef.current && firstFind && name !== "" && had !== name;
          if (shouldWrite) onChangeRef.current({ vendorName: name });
          setState({ kind: "found", registrant: found, replaced: shouldWrite && had !== "" });
        }
        else setState({ kind: "absent" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
    // A local `cancelled` inside the effect, not a ref set on mount:
    // reactStrictMode runs effects mount -> cleanup -> mount, and a ref cleared
    // in the cleanup stays cleared for the rest of the component's life. See
    // the `aliveRef` note in CLAUDE.md.
  }, [digits]);

  const registrant = state.kind === "found" ? state.registrant : null;
  const verdict = registrant ? compareVendorName(vendorName, registrant) : null;
  const offered = registrant ? registrantDisplayName(registrant) : "";
  /**
   * The registered name is on file and the box does not hold it.
   *
   * **Both halves the user asked for on 2026-09-15** — "ไม่ตรงหรือมีการแก้ไข
   * หลังจากนั้น" — are this one condition, which is why there is no second
   * flag for "edited". A name that never matched and a name edited away from a
   * match are the same state to look at: what is in the box is not what the
   * register says. It covers the case the auto-replace deliberately skips too,
   * a saved row opened with a name that disagrees.
   */
  const offerAvailable = verdict === "mismatch" && offered !== "";
  /* Shown only while the box still holds what the lookup put there. Edit it
     afterwards and the note goes — the button above replaces it, because the
     note would then be describing something that is no longer on screen. */
  const replacedNote =
    state.kind === "found" &&
    state.replaced &&
    (vendorName ?? "").trim() === registrantDisplayName(state.registrant);

  return (
    <>
      <div className="min-w-0">
        <input
          type="text"
          aria-label={`เลขประจำตัวผู้เสียภาษีของรายการที่ ${index + 1}`}
          placeholder="0105547161674"
          maxLength={20}
          value={taxId ?? ""}
          onChange={(e) => onChange({ vendorTaxId: e.target.value === "" ? null : e.target.value })}
          className="w-full rounded-lg px-3 py-2 text-[14px] outline-none"
          style={{
            background: "var(--bg-input)",
            color: "var(--text-primary)",
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: problem ? "var(--color-danger)" : "var(--border-input)",
            boxShadow: problem ? "0 0 0 1px var(--color-danger)" : undefined,
          }}
        />
        {problem && (
          <span className="block text-[10.5px] mt-0.5 leading-tight" style={{ color: "var(--color-danger)" }}>
            {problem}
          </span>
        )}
        {!problem && state.kind === "checking" && (
          <span
            className="inline-flex items-center gap-1 text-[10.5px] mt-0.5"
            style={{ color: "var(--text-muted)" }}
          >
            <Loader2 size={10} className="animate-spin" /> กำลังตรวจกับกรมสรรพากร...
          </span>
        )}
        {!problem && state.kind === "absent" && (
          <span className="block text-[10.5px] mt-0.5 leading-tight" style={{ color: "var(--text-muted)" }}>
            ไม่พบในระบบกรมสรรพากร — ใช้ข้อมูลนี้ต่อได้
          </span>
        )}
        {!problem && state.kind === "unavailable" && (
          <span className="block text-[10.5px] mt-0.5 leading-tight" style={{ color: "var(--text-muted)" }}>
            ตรวจกับกรมสรรพากรไม่ได้ตอนนี้ — ใช้ข้อมูลนี้ต่อได้
          </span>
        )}
      </div>

      <div className="min-w-0">
        <input
          type="text"
          aria-label={`ชื่อผู้ขายของรายการที่ ${index + 1}`}
          placeholder="ผู้ขาย"
          maxLength={300}
          value={vendorName ?? ""}
          onChange={(e) => onChange({ vendorName: e.target.value === "" ? null : e.target.value })}
          className="w-full rounded-lg px-3 py-2 text-[14px] outline-none"
          style={{
            background: "var(--bg-input)",
            color: "var(--text-primary)",
            borderWidth: 1,
            borderStyle: "solid",
            // Yellow, not red: a name that disagrees with the register is
            // something to look at, not something that is wrong. It marks which
            // box the button below is about.
            borderColor: offerAvailable ? "var(--border-info-yellow)" : "var(--border-input)",
            boxShadow: offerAvailable ? "0 0 0 1px var(--border-info-yellow)" : undefined,
          }}
        />
        {offerAvailable && (
          <button
            type="button"
            onClick={() => onChange({ vendorName: offered })}
            title={offered}
            className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded cursor-pointer max-w-full"
            style={{
              background: "var(--bg-info-yellow)",
              color: "var(--text-info-yellow)",
              border: "1px solid var(--border-info-yellow)",
            }}
          >
            <span className="truncate">ใช้ชื่อจากกรมสรรพากร: {offered}</span>
          </button>
        )}
        {replacedNote && (
          <span
            className="block text-[10.5px] mt-0.5 leading-tight"
            style={{ color: "var(--text-muted)" }}
          >
            แทนที่ด้วยชื่อจากกรมสรรพากรแล้ว — แก้ไขได้
          </span>
        )}
        {/* Exclusive with the note above: after a replacement the name agrees
            with the register BY CONSTRUCTION, so showing both would be the
            same fact twice — and the interesting half is that the box was
            changed, not that it now matches. */}
        {verdict === "match" && !replacedNote && (
          <span
            className="inline-flex items-center gap-1 text-[10.5px] mt-0.5"
            style={{ color: "var(--color-success)" }}
          >
            <Check size={10} /> ตรงกับกรมสรรพากร
          </span>
        )}
      </div>
    </>
  );
}
