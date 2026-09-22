import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUNNING_NO_SEQ_DIGITS,
  RUNNING_NO_YEAR_DIGITS,
  exampleRequestNo,
  isCompleteRequestNo,
  requestNoPattern,
} from "./running-number";

const TRL = "TRL";

/* ─────────────────────────── the widths ─────────────────────────── */

/**
 * These two numbers are `allocateRequestNo`'s, not this module's. Pinned so a
 * reader who changes the mint and forgets the matcher gets a red suite rather
 * than a picker that silently never fires.
 */
test("the widths are the ones allocateRequestNo mints", () => {
  assert.equal(RUNNING_NO_YEAR_DIGITS, 2);
  assert.equal(RUNNING_NO_SEQ_DIGITS, 5);
});

/* ─────────────────────────── complete / incomplete ─────────────────────────── */

test("a fully typed running number is complete", () => {
  assert.equal(isCompleteRequestNo("TRL26-00100", TRL), true);
  assert.equal(isCompleteRequestNo("TRL26-09001", TRL), true, "UAT's own band is the same shape");
  assert.equal(isCompleteRequestNo("TRL99-99999", TRL), true);
});

/**
 * The prefix alone is what the old three-character gate fired on, and it is
 * what made the picker answer `ไม่พบคำขอเลขที่ TRL` to somebody mid-word.
 */
test("every prefix of a real number is incomplete, including the three that used to search", () => {
  const whole = "TRL26-00100";
  for (let i = 0; i < whole.length; i++) {
    const partial = whole.slice(0, i);
    assert.equal(
      isCompleteRequestNo(partial, TRL),
      false,
      `"${partial}" is not a finished running number and must not reach the server — ` +
        "the lookup is an exact match, so it can only ever answer 'no such number'",
    );
  }
});

test("too few and too many sequence digits are both refused", () => {
  assert.equal(isCompleteRequestNo("TRL26-0010", TRL), false);
  assert.equal(isCompleteRequestNo("TRL26-001000", TRL), false);
});

test("a four-digit year is refused — the mint writes two", () => {
  assert.equal(isCompleteRequestNo("TRL2026-00100", TRL), false);
});

test("the dash is required, and so is the prefix", () => {
  assert.equal(isCompleteRequestNo("TRL2600100", TRL), false);
  assert.equal(isCompleteRequestNo("26-00100", TRL), false);
});

test("another form's running number is not this form's", () => {
  assert.equal(
    isCompleteRequestNo("TOF26-00100", TRL),
    false,
    "AP-1's numbers are the same shape with a different prefix; the picker only lists AP-17",
  );
});

test("the empty string and whitespace are incomplete, never complete", () => {
  for (const raw of ["", " ", "\t", "   \n "]) {
    assert.equal(isCompleteRequestNo(raw, TRL), false);
  }
});

/**
 * A pasted number very often arrives with a space on one end. That is a
 * finished number, and the fetch trims it too.
 */
test("surrounding whitespace is trimmed rather than counted", () => {
  assert.equal(isCompleteRequestNo("  TRL26-00100 ", TRL), true);
});

/**
 * The collation is case-insensitive, so the lower-case spelling really does
 * find the row — refusing it here would leave somebody watching a search that
 * never fires and never says why.
 */
test("case does not decide completeness, because the collation does not either", () => {
  assert.equal(isCompleteRequestNo("trl26-00100", TRL), true);
  assert.equal(isCompleteRequestNo("Trl26-00100", TRL), true);
});

test("inner whitespace is not a running number", () => {
  assert.equal(isCompleteRequestNo("TRL26 - 00100", TRL), false);
  assert.equal(isCompleteRequestNo("TRL 26-00100", TRL), false);
});

/* ─────────────────────────── the pattern is anchored ─────────────────────────── */

/**
 * Both anchors, separately: without `^` a number pasted after other text
 * matches, and without `$` a longer string does — and `RequestNo` is
 * `NVARCHAR(50)`, so there is plenty of room for a caller to append.
 */
test("the pattern is anchored at both ends", () => {
  const re = requestNoPattern(TRL);
  assert.equal(re.test("xxTRL26-00100"), false, "unanchored at the start");
  assert.equal(re.test("TRL26-00100xx"), false, "unanchored at the end");
});

/**
 * A prefix is plain letters today, so this escapes nothing — which is exactly
 * why it would go unnoticed if it were removed. A `.` in an unescaped prefix
 * matches any character, so one form's picker would accept another's numbers.
 */
test("a regex-special character in the prefix is matched literally", () => {
  assert.equal(isCompleteRequestNo("A.B26-00100", "A.B"), true);
  assert.equal(
    isCompleteRequestNo("AXB26-00100", "A.B"),
    false,
    "the dot must be a literal dot, not `any character`",
  );
});

/* ─────────────────────────── the example ─────────────────────────── */

test("the example is built from the viewer's own year, with local getters", () => {
  // 31 December 2026, late evening Thai time — the hour at which toISOString()
  // would answer 2027 and print the wrong year on the placeholder.
  assert.equal(exampleRequestNo(TRL, new Date(2026, 11, 31, 23, 30)), "TRL26-00100");
  assert.equal(exampleRequestNo(TRL, new Date(2027, 0, 1, 0, 30)), "TRL27-00100");
});

/**
 * The example is copy a requester reads the shape off, so it has to BE the
 * shape. Asserted against the matcher rather than against a literal, so the
 * two cannot drift.
 */
test("the example is itself a complete running number", () => {
  const example = exampleRequestNo(TRL, new Date(2026, 5, 1));
  assert.equal(
    isCompleteRequestNo(example, TRL),
    true,
    "the placeholder shows a shape the picker would refuse to search for",
  );
});
