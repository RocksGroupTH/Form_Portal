import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRM_WORD,
  isConfirmWordTyped,
  needsTypedConfirm,
} from "./form-environment-confirm";

test("both Production directions are typed, never clicked", () => {
  // Off hides a live form from everyone. On exposes it to everyone — which was
  // a plain blue button until 2026-08-22, so the more consequential half of the
  // pair was the guarded one and the other was one click away.
  assert.equal(needsTypedConfirm("production", false), true);
  assert.equal(needsTypedConfirm("production", true), true);
});

test("UAT stays a plain confirm in both directions", () => {
  // A UAT switch only ever moves what configured testers see, and its worst
  // case is a tester losing a sandbox. Typing for that trains people to type
  // without reading, which is what makes the Production prompt worth anything.
  assert.equal(needsTypedConfirm("uat", true), false);
  assert.equal(needsTypedConfirm("uat", false), false);
});

test("the confirmation word is matched exactly, apart from surrounding space", () => {
  assert.equal(isConfirmWordTyped(CONFIRM_WORD), true);
  assert.equal(isConfirmWordTyped(`  ${CONFIRM_WORD}  `), true);
  // Case-sensitive on purpose: the prompt shows the word, and a check that
  // accepts "confirm" accepts a reflex rather than a reading.
  assert.equal(isConfirmWordTyped("confirm"), false);
  assert.equal(isConfirmWordTyped("CONFIRM"), false);
  assert.equal(isConfirmWordTyped("Confirmed"), false);
  assert.equal(isConfirmWordTyped("Con firm"), false);
  assert.equal(isConfirmWordTyped(""), false);
  assert.equal(isConfirmWordTyped("   "), false);
});

test("a non-string never passes", () => {
  // The value comes off a controlled input, so it is a string today. Pinned
  // because the failure direction matters: an undefined that compared equal
  // would open the gate rather than close it.
  for (const bad of [null, undefined, 0, {}, []]) {
    assert.equal(isConfirmWordTyped(bad as unknown as string), false);
  }
});
