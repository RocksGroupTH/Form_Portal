import test from "node:test";
import assert from "node:assert/strict";
// The PURE module, never "./form-message" — that one opens a pool, and the
// test runner has no env file, so importing it throws before any assertion.
import { resolveFormMessageBlocks, FORM_MESSAGE_FALLBACK } from "./form-message-fallback";

test("a missing TABLE falls back to the form's constant", () => {
  const out = resolveFormMessageBlocks("AP-1", null, []);
  assert.deepEqual(out.slice(0, 3), Array.from(FORM_MESSAGE_FALLBACK["AP-1"]));
});

test("a missing ROW falls back to the form's constant", () => {
  const out = resolveFormMessageBlocks("AP-1", {}, []);
  assert.deepEqual(out.slice(0, 3), Array.from(FORM_MESSAGE_FALLBACK["AP-1"]));
});

test("a row with an EMPTY body is no notice — not the constant", () => {
  assert.deepEqual(resolveFormMessageBlocks("AP-1", { "AP-1": "" }, []), []);
});

test("a form with no constant and no row shows nothing", () => {
  assert.deepEqual(resolveFormMessageBlocks("AP-2", null, []), []);
  assert.deepEqual(resolveFormMessageBlocks("AP-2", {}, []), []);
});

test("a stored body wins over the constant and expands its token", () => {
  assert.deepEqual(
    resolveFormMessageBlocks("AP-1", { "AP-1": "ถาม {เจ้าของฟอร์ม}" }, [
      { email: "a@rocksgroup.com", displayName: "Ay One" },
    ]),
    ["ถาม Ay One (a@rocksgroup.com)"],
  );
});
