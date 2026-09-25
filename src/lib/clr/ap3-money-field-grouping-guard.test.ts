import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Every money field on the AP-3 request form reads `1,000`, and nothing
 * noticed when one of them didn't.**
 *
 * `AmountInput` replaced eight `<input type="number">` fields on 2026-09-25.
 * A ninth — จำนวนเงินที่โอนคืน (บาท) — was missed, and stayed missed until a
 * user reported it, because the earlier work was a hand-listed sweep: nothing
 * in the repo knew how many money fields the form had, so nothing could say one
 * was left behind. Every test stayed green.
 *
 * This is that missing check, and it is deliberately blunt: **the AP-3 request
 * form contains no `type="number"` input at all.** A money field cannot show a
 * separator as a number input — the browser rejects the comma and hands the
 * field back empty — so on this form, which is money end to end, a number input
 * IS the bug. Scanning for "number inputs that look like money" would need a
 * heuristic, and a heuristic is how the ninth field was missed.
 *
 * If a genuinely non-money number field is ever wanted here (a count, a
 * percentage), this guard is the thing to change, on purpose, with a reason —
 * which is the point. It is not pinning a style; it is pinning that somebody
 * decided.
 */

const FORM = path.join(
  process.cwd(),
  "src/features/clear-advance/components/ClearAdvanceForm.tsx",
);

/** CRLF on a Windows checkout, LF in the blob — see adc-link-guard.test.ts. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the AP-3 request form has no bare number input left", () => {
  const src = code(FORM);
  assert.ok(src.length > 0, "ClearAdvanceForm.tsx read as empty — the guard is scanning nothing");

  const bare = src.match(/type="number"/g) ?? [];
  assert.equal(
    bare.length,
    0,
    `${bare.length} <input type="number"> left on the AP-3 request form. A money field ` +
      `must be <AmountInput>: a number input cannot display "1,000" — the browser ` +
      `rejects the comma and returns an empty string. If this is deliberately not a ` +
      `money field, update this guard and say why.`,
  );
});

test("the form is actually using AmountInput, so the check above is not passing by absence", () => {
  // Without this, deleting every money field from the form would make the guard
  // above green — the failure it exists to catch would become undetectable in
  // exactly the situation where it matters most.
  const src = code(FORM);
  assert.match(src, /import \{ AmountInput \}/, "the form no longer imports AmountInput");
  const uses = src.match(/<AmountInput\b/g) ?? [];
  assert.ok(
    uses.length >= 11,
    `only ${uses.length} <AmountInput> on the AP-3 request form; there were 11 when this ` +
      `guard was written — the form renders a desktop table and a mobile card list, so ` +
      `several money fields appear twice. If a money field was genuinely removed, lower ` +
      `this number deliberately — do not let it drift.`,
  );
});
