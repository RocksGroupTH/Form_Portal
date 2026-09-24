import test from "node:test";
import assert from "node:assert/strict";
import { planGlSuggestions } from "./gl-suggest-targets";
import { linesMissingGl } from "./clear-advance-line-validation";

/**
 * Which lines the suggest button asks about, and what it says about the rest.
 *
 * The property at the bottom is the point: every line the approval gate
 * complains about must come back either as a target or in one of the counts.
 * A line that falls out of both is a line the officer is blocked on and never
 * told about — the button would appear to work and the gate would stay red.
 */

const line = (over: Partial<Record<string, unknown>> = {}) => ({
  glAccountNo: "", amountBeforeVat: 100, description: "ค่าแท็กซี่", branchCode: "HQ01", ...over,
});

test("an empty G/L with a description, a branch and an amount is a target", () => {
  const p = planGlSuggestions([line()]);
  assert.deepEqual(p.targets, [0]);
  assert.deepEqual(p.noDescription, []);
  assert.deepEqual(p.noBranch, []);
});

test("an account already chosen is the officer's answer, not a target", () => {
  assert.deepEqual(planGlSuggestions([line({ glAccountNo: "610322005" })]).targets, []);
});

test("a zero-amount line is not a target, matching the gate", () => {
  const items = [line({ amountBeforeVat: 0 })];
  assert.deepEqual(planGlSuggestions(items).targets, []);
  assert.deepEqual(linesMissingGl(items), []);
});

test("no description is counted, not silently dropped", () => {
  const p = planGlSuggestions([line({ description: "   " })]);
  assert.deepEqual(p.targets, []);
  assert.deepEqual(p.noDescription, [0]);
});

test("no branch is counted, not guessed at", () => {
  const p = planGlSuggestions([line({ branchCode: "" })]);
  assert.deepEqual(p.targets, []);
  assert.deepEqual(p.noBranch, [0]);
});

test("every line the gate complains about is accounted for", () => {
  const items = [
    line(),
    line({ glAccountNo: "610322005" }),
    line({ description: "" }),
    line({ branchCode: null }),
    line({ amountBeforeVat: 0 }),
    line({ amountBeforeVat: 0, description: "" }),
    line({ description: "", branchCode: "" }),
  ];
  const p = planGlSuggestions(items);
  const accountedFor = [...p.targets, ...p.noDescription, ...p.noBranch].map((i) => i + 1).sort((a, b) => a - b);
  assert.deepEqual(
    accountedFor,
    linesMissingGl(items),
    "a line the gate blocks on fell out of every bucket",
  );
});

test("a line is counted once, even when it lacks both", () => {
  const p = planGlSuggestions([line({ description: "", branchCode: "" })]);
  const all = [...p.targets, ...p.noDescription, ...p.noBranch];
  assert.equal(new Set(all).size, all.length);
});
