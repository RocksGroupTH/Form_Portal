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
 * - **found and the name does not** — the registered name **replaces** what was
 *   typed, and a line says it did (user, 2026-09-15: "ถ้า เลขผู้เสียภาษี
 *   ค้นหาเจอ และ ผู้ขาย ข้อมูลไม่ตรงกับ ให้แทนที่ไปเลยไม่ต้องถามเตือน"). It
 *   used to offer the name on a yellow button instead, on the reasoning that a
 *   receipt can print a trading name the register has never heard of and a
 *   fuzzy comparison should not overwrite a person — the user overruled that,
 *   and the ledger wants the registered name in any case. **The replacement
 *   happens once, when the number resolves**: the box is an ordinary input
 *   afterwards, so somebody who really does want the trading name types it and
 *   nothing takes it back.
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
   * The tax id this row already had when the form opened.
   *
   * **A saved row is looked up but never overwritten**, and that is the whole
   * job of this ref. The lookup fires whenever the number is 13 digits long,
   * mount included, so without it reopening a draft would silently rewrite a
   * seller name somebody had deliberately corrected to the trading name on the
   * receipt — replacing a decision nobody was making at the time. Replacement
   * follows the ACT of entering a number, so it is gated on the number having
   * changed since the row was loaded. Editing the id back to its original value
   * skips too, which errs toward leaving a typed name alone.
   *
   * Stable under `reactStrictMode`'s mount → cleanup → mount, unlike a "first
   * run" flag: it compares values rather than counting effect runs.
   */
  const mountDigitsRef = useRef(digits);
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
          const isLoadedRow = digits === mountDigitsRef.current;
          const shouldWrite = !isLoadedRow && name !== "" && had !== name;
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
  /* Shown only while the box still holds what the lookup put there. Edit it
     afterwards and the note goes, because it would then be describing
     something that is no longer on screen. */
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
            borderColor: "var(--border-input)",
          }}
        />
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
