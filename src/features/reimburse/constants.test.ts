import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RULE_TEXT_MAX,
  RULE_TEXT_REQUIRED,
  RULE_TEXT_TOO_LONG,
  validateRuleText,
} from "./constants";

/*
 * The 1,000-character boundary on `AccReimburseRule.RuleText`.
 *
 * Worth a test rather than a code read: the column is `NVARCHAR(1000)` and SQL
 * Server truncates silently on some paths, so a rule accepted one character
 * over is published looking complete while missing its last clause — and these
 * are compliance lines a requester ticks and `AccReimburseRuleAck` records
 * them as having agreed to.
 */

test("ordinary text is accepted and comes back trimmed", () => {
  const r = validateRuleText("  ห้ามเบิกค่าเดินทาง  ");
  assert.equal(r.error, null);
  assert.equal(r.text, "ห้ามเบิกค่าเดินทาง");
});

test("exactly the maximum is accepted — the bound is inclusive", () => {
  const r = validateRuleText("ก".repeat(RULE_TEXT_MAX));
  assert.equal(r.error, null);
  assert.equal(r.text?.length, RULE_TEXT_MAX);
});

test("one character over is refused rather than truncated", () => {
  const r = validateRuleText("ก".repeat(RULE_TEXT_MAX + 1));
  assert.equal(r.text, null);
  assert.equal(r.error, RULE_TEXT_TOO_LONG);
});

test("the length is measured after trimming, not before", () => {
  // Padding a maximum-length rule with spaces must not tip it over: the
  // trimmed string is what the column receives.
  const r = validateRuleText(`   ${"ก".repeat(RULE_TEXT_MAX)}   `);
  assert.equal(r.error, null);
  assert.equal(r.text?.length, RULE_TEXT_MAX);
});

test("empty, whitespace-only and non-string input are all refused", () => {
  for (const bad of ["", "   ", "\n\t", null, undefined, 42, {}, []]) {
    const r = validateRuleText(bad);
    assert.equal(r.text, null, `expected ${JSON.stringify(bad)} to be refused`);
    assert.equal(r.error, RULE_TEXT_REQUIRED);
  }
});

test("the too-long message names the actual bound", () => {
  // The editor shows a counter against RULE_TEXT_MAX; the message the server
  // sends back has to agree with it or the two disagree about the same rule.
  assert.ok(RULE_TEXT_TOO_LONG.indexOf(String(RULE_TEXT_MAX)) !== -1);
});
