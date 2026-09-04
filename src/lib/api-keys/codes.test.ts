import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeApiKeyCode,
  apiKeyCodeError,
  apiKeyNameError,
  API_KEY_CODE_MAX,
  API_KEY_NAME_MAX,
} from "./codes";

/**
 * `normalizeApiKeyCode` is the **only** thing that actually uppercases a CODE.
 *
 * The obvious second line of defence does not exist: `CK_ApiKey_CodeUpper`
 * (migration 116) is `Code = UPPER(Code)`, and this database's collation is
 * case-insensitive, so that predicate is true of every string. Measured
 * 2026-09-04 by asking the live server `SELECT CASE WHEN 'abc' = UPPER('abc')`,
 * which answered 1. The constraint is real defence on a case-SENSITIVE
 * collation and inert here, which is exactly why the function below needs a
 * test of its own — it had none, and it lived in `service.ts` where `@/env`
 * made one impossible.
 *
 * `CK_ApiKey_CodeShape` is likewise weaker than it reads: its only length test
 * is `LEN(Code) > 0`, so `___` satisfies it.
 */

test("uppercases, and stores what it uppercased", () => {
  assert.equal(normalizeApiKeyCode("anthropic_api_key"), "ANTHROPIC_API_KEY");
  assert.equal(normalizeApiKeyCode("  ors_api_key  "), "ORS_API_KEY");
});

/**
 * Coercion is deliberate: somebody typing the key's own env-var name with
 * hyphens, or pasting it with a space, means the same code.
 */
test("coerces unusable characters to underscore rather than refusing", () => {
  assert.equal(normalizeApiKeyCode("ANTHROPIC-API-KEY"), "ANTHROPIC_API_KEY");
  assert.equal(normalizeApiKeyCode("ANTHROPIC API KEY"), "ANTHROPIC_API_KEY");
  assert.equal(normalizeApiKeyCode("google.maps.key"), "GOOGLE_MAPS_KEY");
});

test("a valid code passes both halves unchanged", () => {
  assert.equal(apiKeyCodeError("ANTHROPIC_API_KEY"), null);
  assert.equal(apiKeyCodeError("bot_currency_rate"), null);
});

test("an empty or whitespace-only code is refused", () => {
  assert.equal(apiKeyCodeError(""), "กรุณากรอก CODE");
  assert.equal(apiKeyCodeError("   "), "กรุณากรอก CODE");
});

/**
 * The case this validator was added for. The dialog normalises on every
 * keystroke, so three spaces reach the server already turned into `___` — past
 * `trim()`, past the emptiness check, and past `CK_ApiKey_CodeShape`. It would
 * have been created as a real code, and CODE is immutable after creation.
 */
test("a code of nothing but underscores is refused", () => {
  assert.equal(
    apiKeyCodeError("___"),
    "CODE ต้องมีตัวอักษรหรือตัวเลขอย่างน้อย 1 ตัว",
  );
  // The shape the browser actually posts for three typed spaces.
  assert.equal(normalizeApiKeyCode("   ".toUpperCase().replace(/[^A-Z0-9_]/g, "_")), "___");
  assert.notEqual(apiKeyCodeError("_-_"), null);
});

test("one alphanumeric character is enough", () => {
  assert.equal(apiKeyCodeError("_A_"), null);
  assert.equal(apiKeyCodeError("_1_"), null);
});

/** `Code` is `nvarchar(64)`; over-long reached the admin as a raw driver error. */
test("an over-long code is refused at the boundary, not one short of it", () => {
  assert.equal(apiKeyCodeError("A".repeat(API_KEY_CODE_MAX)), null);
  assert.equal(
    apiKeyCodeError("A".repeat(API_KEY_CODE_MAX + 1)),
    `CODE ยาวเกิน ${API_KEY_CODE_MAX} ตัวอักษร`,
  );
});

/** Length is measured after normalising, since that is what gets stored. */
test("length is measured on the normalised value", () => {
  assert.equal(apiKeyCodeError("  " + "A".repeat(API_KEY_CODE_MAX) + "  "), null);
});

test("a name is required and bounded", () => {
  assert.equal(apiKeyNameError("Anthropic"), null);
  assert.equal(apiKeyNameError(""), "กรุณากรอกชื่อ");
  assert.equal(apiKeyNameError("   "), "กรุณากรอกชื่อ");
  assert.equal(apiKeyNameError("n".repeat(API_KEY_NAME_MAX)), null);
  assert.equal(
    apiKeyNameError("n".repeat(API_KEY_NAME_MAX + 1)),
    `ชื่อยาวเกิน ${API_KEY_NAME_MAX} ตัวอักษร`,
  );
});

/**
 * The bounds must match the columns migration 116 declares. A number changed
 * here without the column changing turns a caught, translated refusal back into
 * the untranslated truncation error this validation replaced.
 */
test("the bounds are the column widths", () => {
  assert.equal(API_KEY_CODE_MAX, 64);
  assert.equal(API_KEY_NAME_MAX, 200);
});
