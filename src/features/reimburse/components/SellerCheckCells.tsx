"use client";

import { useEffect, useState } from "react";
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
  /** On the register. `verdict` says whether the typed name agrees. */
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
 * - **found and the name does not** — the ผู้ขาย box gets a yellow border and a
 *   button offering the registered name. Not an error and never auto-applied: a
 *   receipt can legitimately print a trading name the register has never heard
 *   of, and overwriting what somebody typed on the strength of a fuzzy name
 *   comparison is exactly the wrong way round.
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
        else if (json.data?.registrant) setState({ kind: "found", registrant: json.data.registrant });
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
  const mismatch = verdict === "mismatch" && offered !== "";

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
            // something to look at, not something that is wrong.
            borderColor: mismatch ? "var(--border-info-yellow)" : "var(--border-input)",
            boxShadow: mismatch ? "0 0 0 1px var(--border-info-yellow)" : undefined,
          }}
        />
        {mismatch && (
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
            <span className="truncate">ใช้ข้อมูลจากระบบ: {offered}</span>
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
