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
  /** On the register. `verdict` says whether the box agrees. */
  | { kind: "found"; registrant: Registrant }
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
 *   **Every find replaces the seller name** (user, 2026-09-15, after asking
 *   for it narrower twice and then for it plainly). A lookup runs only when the
 *   tax id reaches thirteen digits, so "a find" is always an act on the number:
 *   the receipt read filling a new row, or somebody typing or correcting one.
 *   The register's name is the one the ledger wants, and it is taken rather
 *   than offered.
 *
 *   **Editing the NAME is not a find** — the effect keys on the tax id alone —
 *   so a trading name typed over the registered one survives, and the button
 *   below is how it gets back. That is the whole reason the two coexist.
 *
 *   **A saved draft reopened is a find too**, because the lookup fires on
 *   mount for any thirteen-digit number: a seller name corrected by hand and
 *   saved is overwritten the next time that request is opened. Raised, and the
 *   plain rule was asked for anyway — the gates that used to prevent it
 *   (`fromDocumentRead`, `foundOnceRef`) are gone rather than left in to
 *   contradict it quietly.
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
          // may have been typed or changed. The stale copy would make this an
          // UPDATE of a value that is no longer there — writing the register's
          // name over a keystroke somebody made while the fetch was in flight,
          // or skipping the write on a comparison that is no longer true.
          const had = (nameRef.current ?? "").trim();
          if (name !== "" && had !== name) onChangeRef.current({ vendorName: name });
          setState({ kind: "found", registrant: found });
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

  return (
    <>
      <div className="min-w-0">
        <input
          type="text"
          aria-label={`เลขประจำตัวผู้เสียภาษีของรายการที่ ${index + 1}`}
          placeholder="0105547161674"
          /* Digits only, thirteen of them (user, 2026-09-15). It accepted any
             twenty characters before, because `taxIdDigits` strips the grouping
             receipts print and the field was left permissive to match. That is
             the right rule for a value being READ off a document and the wrong
             one for a box somebody types into: a letter or a fourteenth digit
             could be entered and then only reported as an error underneath.
             Filtering on the way in means the box cannot hold something the
             column will not take.

             `inputMode` rather than `type="number"`: a tax id is a string of
             digits, not a quantity — a number input brings a spinner, accepts
             `1e5`, and drops leading zeros, and every Thai tax id starts with
             one. */
          inputMode="numeric"
          maxLength={TAX_ID_LENGTH}
          value={taxId ?? ""}
          onChange={(e) => {
            const digitsOnly = e.target.value.replace(/[^0-9]/g, "").slice(0, TAX_ID_LENGTH);
            onChange({ vendorTaxId: digitsOnly === "" ? null : digitsOnly });
          }}
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
        {verdict === "match" && (
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
