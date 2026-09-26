import test from "node:test";
import assert from "node:assert/strict";
// The PURE module, never "./form-message" — that one opens a pool, and the
// test runner has no env file, so importing it throws before any assertion.
import { resolveFormMessageBlocks, FORM_MESSAGE_FALLBACK } from "./form-message-fallback";
import { AP1_HEADER_MESSAGE_LINES } from "@/features/accounting/constants";
import { FORM_OWNER_FALLBACK } from "./form-owner-text";

test("a missing TABLE falls back to the form's constant", () => {
  const out = resolveFormMessageBlocks("AP-1", null, []);
  assert.deepEqual(out.slice(0, 3), Array.from(AP1_HEADER_MESSAGE_LINES));
});

test("a missing ROW falls back to the form's constant", () => {
  const out = resolveFormMessageBlocks("AP-1", {}, []);
  assert.deepEqual(out.slice(0, 3), Array.from(AP1_HEADER_MESSAGE_LINES));
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

// Whole-branch review fix — `out.slice(0, 3)` above is trivially the WHOLE
// fallback array, so it would have accepted a 4th block silently. AP-1's
// footer block (deleted along with this feature's move into settings) was the
// only thing that ever rendered AP-1's contact line, and AP-1 renders no
// `FormOwnerNotice` anywhere else — so AP-1's *fallback* must carry a fourth
// bullet the raw `AP1_HEADER_MESSAGE_LINES` constant does not, or a
// pre-migration-164 deploy (or a later-deleted `FormMessage` row) shows three
// bullets and no way to reach the form's owner at all.
test("AP-1's fallback is one bullet longer than its raw constant, and the extra bullet is the contact line", () => {
  assert.equal(FORM_MESSAGE_FALLBACK["AP-1"].length, AP1_HEADER_MESSAGE_LINES.length + 1);
  assert.deepEqual(
    Array.from(FORM_MESSAGE_FALLBACK["AP-1"]).slice(0, AP1_HEADER_MESSAGE_LINES.length),
    Array.from(AP1_HEADER_MESSAGE_LINES),
  );
});

test("the missing-table fallback's 4th bullet names the owner when one is configured", () => {
  const out = resolveFormMessageBlocks("AP-1", null, [
    { email: "owner@rocksgroup.com", displayName: "Form Owner" },
  ]);
  assert.equal(out.length, 4);
  assert.equal(out[3], "กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: Form Owner (owner@rocksgroup.com)");
});

test("the missing-table fallback's 4th bullet degrades to the bare sentence with no owner configured", () => {
  const out = resolveFormMessageBlocks("AP-1", null, []);
  assert.equal(out.length, 4);
  assert.equal(out[3], FORM_OWNER_FALLBACK);
});
